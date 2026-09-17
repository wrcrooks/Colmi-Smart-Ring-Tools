#include "colmi_ring.h"
#include "esphome/core/helpers.h"
#include "esphome/core/log.h"

#ifdef USE_ESP32

namespace esphome {
namespace colmi_ring {

static const char *const TAG = "colmi_ring";
static const uint32_t TIMEOUT_MS = 15000;

std::vector<uint8_t> make_packet(uint8_t command, const std::vector<uint8_t> &payload) {
  std::vector<uint8_t> packet(16, 0);
  packet[0] = command;
  for (size_t i = 0; i < payload.size() && i < 14; i++) packet[i + 1] = payload[i];
  uint16_t sum = 0;
  for (int i = 0; i < 15; i++) sum += packet[i];
  packet[15] = sum & 0xFF;
  return packet;
}

// ---- HeartRateLogParser ----------------------------------------------------

void HeartRateLogParser::reset() {
  this->size_ = 0;
  this->range_ = 5;
  this->sample_index_ = 0;
  this->latest_reading_ = 0;
  this->hourly_.fill(HourBucket{});
}

bool HeartRateLogParser::parse(const uint8_t *packet, uint16_t len) {
  if (len < 16) return true;  // malformed, don't hang the state machine
  uint8_t sub_type = packet[1];

  if (sub_type == 255) return true;  // no data for today

  // The firmware only ever requests "today" (see heart_rate_request_payload_),
  // and for a today-query the ring terminates at sub_type 23 regardless of
  // the `size` field from the sub_type-0 header — mirrors colmi_r02_client's
  // `is_today() and sub_type == 23` special case. Packet 23 itself carries no
  // additional samples. Without this, a today-query never satisfies the
  // generic `sub_type == size - 1` check below and the state machine hangs
  // until it times out.
  if (sub_type == 23) return true;

  if (sub_type == 0) {
    this->size_ = packet[2];
    if (packet[3] > 0) this->range_ = packet[3];
    return false;
  }

  if (sub_type == 1) {
    for (int i = 0; i < 9; i++) this->note_sample_(packet[6 + i]);
  } else {
    for (int i = 0; i < 13; i++) this->note_sample_(packet[2 + i]);
  }

  return sub_type == this->size_ - 1;
}

// ---- StepsLogParser ---------------------------------------------------------

void StepsLogParser::reset() {
  this->index_ = 0;
  this->new_calorie_protocol_ = false;
  this->has_data_ = false;
  this->steps_ = 0;
  this->calories_ = 0;
  this->distance_ = 0;
}

bool StepsLogParser::parse(const uint8_t *packet, uint16_t len) {
  if (len < 16) return true;

  if (this->index_ == 0 && packet[1] == 255) return true;  // no data for today

  if (this->index_ == 0 && packet[1] == 240) {
    this->new_calorie_protocol_ = packet[3] == 1;
    this->index_++;
    return false;
  }

  this->has_data_ = true;
  uint32_t calories = packet[7] | (packet[8] << 8);
  if (this->new_calorie_protocol_) calories *= 10;
  this->calories_ += calories;
  this->steps_ += packet[9] | (packet[10] << 8);
  this->distance_ += packet[11] | (packet[12] << 8);

  bool complete = packet[5] == packet[6] - 1;
  this->index_++;
  return complete;
}

// ---- SleepLogParser (experimental) ------------------------------------------

void SleepLogParser::reset() {
  this->index_ = 0;
  this->has_data_ = false;
  this->minutes_ = 0;
}

bool SleepLogParser::parse(const uint8_t *packet, uint16_t len) {
  if (len < 16) return true;

  if (this->index_ == 0 && packet[1] == 255) return true;

  if (this->index_ == 0 && packet[1] == 240) {
    this->index_++;
    return false;
  }

  this->has_data_ = true;
  uint8_t stage_raw = packet[7];
  if (stage_raw != 0) this->minutes_ += 15;

  bool complete = packet[5] == packet[6] - 1;
  this->index_++;
  return complete;
}

// ---- ColmiRing ---------------------------------------------------------------

void ColmiRing::dump_config() {
  ESP_LOGCONFIG(TAG, "Colmi Ring:");
  ESP_LOGCONFIG(TAG, "  MAC address: %s", this->parent()->address_str().c_str());
  LOG_SENSOR("  ", "Battery", this->battery_sensor_);
  LOG_BINARY_SENSOR("  ", "Charging", this->charging_sensor_);
  LOG_SENSOR("  ", "Steps", this->steps_sensor_);
  LOG_SENSOR("  ", "Calories", this->calories_sensor_);
  LOG_SENSOR("  ", "Distance", this->distance_sensor_);
  LOG_SENSOR("  ", "Heart rate", this->heart_rate_sensor_);
  LOG_SENSOR("  ", "Sleep minutes (experimental)", this->sleep_minutes_sensor_);
  LOG_TEXT_SENSOR("  ", "Last sync", this->last_sync_sensor_);
  LOG_TEXT_SENSOR("  ", "Heart rate history", this->heart_rate_history_sensor_);
  LOG_UPDATE_INTERVAL(this);
}

void ColmiRing::loop() {
  if (this->state_ == SyncState::IDLE) return;
  if (millis() - this->last_activity_ms_ > TIMEOUT_MS) {
    ESP_LOGW(TAG, "Timed out waiting for a ring response (state=%d), aborting this poll cycle",
             static_cast<int>(this->state_));
    this->state_ = SyncState::IDLE;
  }
}

void ColmiRing::update() {
  if (this->node_state != espbt::ClientState::ESTABLISHED) {
    ESP_LOGD(TAG, "Not connected yet, skipping poll");
    return;
  }
  if (this->rx_handle_ == 0 || this->tx_handle_ == 0) {
    ESP_LOGW(TAG, "Ring GATT characteristics not resolved yet, skipping poll");
    return;
  }
  if (this->state_ != SyncState::IDLE) {
    ESP_LOGW(TAG, "Previous poll cycle never finished (state=%d), restarting", static_cast<int>(this->state_));
  }
  this->begin_cycle_();
}

void ColmiRing::begin_cycle_() {
  this->heart_rate_parser_.reset();
  this->steps_parser_.reset();
  this->sleep_parser_.reset();

  if (this->time_source_ != nullptr && this->time_source_->now().is_valid()) {
    auto now = this->time_source_->now();
    std::vector<uint8_t> payload = {
        decimal_to_bcd(now.year % 100), decimal_to_bcd(now.month), decimal_to_bcd(now.day_of_month),
        decimal_to_bcd(now.hour),       decimal_to_bcd(now.minute), decimal_to_bcd(now.second),
        1,  // language: 1 = English
    };
    this->state_ = SyncState::SETTING_TIME;
    this->write_packet_(CMD_SET_TIME, payload);
  } else {
    this->state_ = SyncState::READING_BATTERY;
    this->write_packet_(CMD_BATTERY);
  }
}

std::vector<uint8_t> ColmiRing::heart_rate_request_payload_() {
  uint32_t midnight = 0;
  if (this->time_source_ != nullptr) {
    auto now = this->time_source_->now();
    if (now.is_valid()) {
      now.hour = 0;
      now.minute = 0;
      now.second = 0;
      now.recalc_timestamp_utc(false);
      if (now.timestamp > 0) midnight = static_cast<uint32_t>(now.timestamp);
    }
  }
  return {
      static_cast<uint8_t>(midnight & 0xFF),
      static_cast<uint8_t>((midnight >> 8) & 0xFF),
      static_cast<uint8_t>((midnight >> 16) & 0xFF),
      static_cast<uint8_t>((midnight >> 24) & 0xFF),
  };
}

std::string ColmiRing::heart_rate_history_string_() {
  // Same midnight computation as heart_rate_request_payload_, so the hour
  // buckets line up with the day the ring actually returned.
  uint32_t midnight = 0;
  if (this->time_source_ != nullptr) {
    auto now = this->time_source_->now();
    if (now.is_valid()) {
      now.hour = 0;
      now.minute = 0;
      now.second = 0;
      now.recalc_timestamp_utc(false);
      if (now.timestamp > 0) midnight = static_cast<uint32_t>(now.timestamp);
    }
  }

  std::string out = to_string(midnight) + "|";
  const auto &hourly = this->heart_rate_parser_.hourly();
  for (uint8_t h = 0; h < 24; h++) {
    if (h > 0) out += ";";
    const auto &b = hourly[h];
    if (b.count == 0) {
      out += "x";
    } else {
      uint32_t mean = b.sum / b.count;
      out += to_string(mean) + "," + to_string(b.min) + "," + to_string(b.max);
    }
  }
  return out;
}

void ColmiRing::write_packet_(uint8_t command, const std::vector<uint8_t> &payload) {
  auto packet = make_packet(command, payload);
  this->last_activity_ms_ = millis();
  auto status = esp_ble_gattc_write_char(this->parent()->get_gattc_if(), this->parent()->get_conn_id(),
                                         this->rx_handle_, packet.size(), packet.data(), ESP_GATT_WRITE_TYPE_NO_RSP,
                                         ESP_GATT_AUTH_REQ_NONE);
  if (status != ESP_GATT_OK) {
    ESP_LOGW(TAG, "Write failed for command %d, status=%d", command, status);
    this->state_ = SyncState::IDLE;
  }
}

void ColmiRing::finish_cycle_() {
  this->state_ = SyncState::IDLE;
  if (this->last_sync_sensor_ != nullptr && this->time_source_ != nullptr) {
    auto now = this->time_source_->now();
    if (now.is_valid()) {
      this->last_sync_sensor_->publish_state(now.strftime("%Y-%m-%d %H:%M:%S"));
    }
  }
  ESP_LOGD(TAG, "Poll cycle complete");
}

void ColmiRing::handle_notify_(const uint8_t *data, uint16_t len) {
  if (len < 1) return;
  uint8_t command = data[0];
  this->last_activity_ms_ = millis();

  switch (this->state_) {
    case SyncState::SETTING_TIME: {
      if (command != CMD_SET_TIME) return;
      this->state_ = SyncState::READING_BATTERY;
      this->write_packet_(CMD_BATTERY);
      break;
    }

    case SyncState::READING_BATTERY: {
      if (command != CMD_BATTERY) return;
      if (len >= 3) {
        uint8_t level = data[1];
        bool charging = data[2] != 0;
        if (this->battery_sensor_ != nullptr) this->battery_sensor_->publish_state(level);
        if (this->charging_sensor_ != nullptr) this->charging_sensor_->publish_state(charging);
      }
      this->state_ = SyncState::READING_HEART_RATE;
      this->write_packet_(CMD_READ_HEART_RATE, this->heart_rate_request_payload_());
      break;
    }

    case SyncState::READING_HEART_RATE: {
      if (command != CMD_READ_HEART_RATE) return;
      ESP_LOGV(TAG, "HR packet: %s", format_hex_pretty(data, len).c_str());
      if (!this->heart_rate_parser_.parse(data, len)) return;
      ESP_LOGD(TAG, "Heart rate log complete: has_reading=%s latest=%u", YESNO(this->heart_rate_parser_.has_reading()),
               this->heart_rate_parser_.latest_reading());
      if (this->heart_rate_parser_.has_reading() && this->heart_rate_sensor_ != nullptr) {
        this->heart_rate_sensor_->publish_state(this->heart_rate_parser_.latest_reading());
      }
      if (this->heart_rate_history_sensor_ != nullptr) {
        this->heart_rate_history_sensor_->publish_state(this->heart_rate_history_string_());
      }
      this->state_ = SyncState::READING_STEPS;
      this->write_packet_(CMD_GET_STEP_SOMEDAY, {0, 0x0f, 0x00, 0x5f, 0x01});
      break;
    }

    case SyncState::READING_STEPS: {
      if (command != CMD_GET_STEP_SOMEDAY) return;
      ESP_LOGV(TAG, "Steps packet: %s", format_hex_pretty(data, len).c_str());
      if (!this->steps_parser_.parse(data, len)) return;
      ESP_LOGD(TAG, "Steps log complete: has_data=%s steps=%u calories=%u distance=%u",
               YESNO(this->steps_parser_.has_data()), this->steps_parser_.steps(), this->steps_parser_.calories(),
               this->steps_parser_.distance());
      if (this->steps_parser_.has_data()) {
        if (this->steps_sensor_ != nullptr) this->steps_sensor_->publish_state(this->steps_parser_.steps());
        if (this->calories_sensor_ != nullptr) this->calories_sensor_->publish_state(this->steps_parser_.calories());
        if (this->distance_sensor_ != nullptr) this->distance_sensor_->publish_state(this->steps_parser_.distance());
      }
      if (this->sleep_minutes_sensor_ != nullptr) {
        this->state_ = SyncState::READING_SLEEP;
        this->write_packet_(CMD_SLEEP, {0, 0x0f, 0x00, 0x5f, 0x01});
      } else {
        this->finish_cycle_();
      }
      break;
    }

    case SyncState::READING_SLEEP: {
      if (command != CMD_SLEEP) return;
      ESP_LOGV(TAG, "Sleep packet: %s", format_hex_pretty(data, len).c_str());
      if (!this->sleep_parser_.parse(data, len)) return;
      ESP_LOGD(TAG, "Sleep log complete: has_data=%s estimated_minutes=%u", YESNO(this->sleep_parser_.has_data()),
               this->sleep_parser_.estimated_minutes());
      if (this->sleep_parser_.has_data() && this->sleep_minutes_sensor_ != nullptr) {
        this->sleep_minutes_sensor_->publish_state(this->sleep_parser_.estimated_minutes());
      }
      this->finish_cycle_();
      break;
    }

    case SyncState::IDLE:
    default:
      break;
  }
}

void ColmiRing::gattc_event_handler(esp_gattc_cb_event_t event, esp_gatt_if_t gattc_if,
                                    esp_ble_gattc_cb_param_t *param) {
  switch (event) {
    case ESP_GATTC_SEARCH_CMPL_EVT: {
      auto service_uuid = espbt::ESPBTUUID::from_raw(std::string(SERVICE_UUID));
      auto rx_uuid = espbt::ESPBTUUID::from_raw(std::string(RX_CHAR_UUID));
      auto tx_uuid = espbt::ESPBTUUID::from_raw(std::string(TX_CHAR_UUID));

      auto *rx_chr = this->parent()->get_characteristic(service_uuid, rx_uuid);
      auto *tx_chr = this->parent()->get_characteristic(service_uuid, tx_uuid);
      if (rx_chr == nullptr || tx_chr == nullptr) {
        ESP_LOGW(TAG, "Ring service/characteristics not found — is this a Colmi RF03-family ring?");
        break;
      }
      this->rx_handle_ = rx_chr->handle;
      this->tx_handle_ = tx_chr->handle;

      auto status = esp_ble_gattc_register_for_notify(this->parent()->get_gattc_if(),
                                                       this->parent()->get_remote_bda(), this->tx_handle_);
      if (status) {
        ESP_LOGW(TAG, "esp_ble_gattc_register_for_notify failed, status=%d", status);
      }
      break;
    }

    case ESP_GATTC_REG_FOR_NOTIFY_EVT: {
      if (param->reg_for_notify.handle != this->tx_handle_) break;
      if (param->reg_for_notify.status != ESP_GATT_OK) {
        ESP_LOGW(TAG, "Failed to register for notifications, status=%d", param->reg_for_notify.status);
        break;
      }
      this->node_state = espbt::ClientState::ESTABLISHED;
      ESP_LOGI(TAG, "[%s] Ring ready", this->parent()->address_str().c_str());
      break;
    }

    case ESP_GATTC_NOTIFY_EVT: {
      if (param->notify.handle != this->tx_handle_) break;
      this->handle_notify_(param->notify.value, param->notify.value_len);
      break;
    }

    case ESP_GATTC_CLOSE_EVT: {
      ESP_LOGW(TAG, "[%s] Ring disconnected", this->parent()->address_str().c_str());
      this->rx_handle_ = 0;
      this->tx_handle_ = 0;
      this->state_ = SyncState::IDLE;
      break;
    }

    default:
      break;
  }
}

}  // namespace colmi_ring
}  // namespace esphome
#endif
