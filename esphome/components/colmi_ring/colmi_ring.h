#pragma once

// Colmi R02/R06-family ring GATT client. See ../../docs/PROTOCOL.md for the
// wire protocol this implements (packet format, command ids, multi-packet
// log framing) — this is a C++ port of the same logic used by webapp/src/ble.

#include "esphome/core/component.h"
#include "esphome/components/ble_client/ble_client.h"
#include "esphome/components/esp32_ble_tracker/esp32_ble_tracker.h"
#include "esphome/components/binary_sensor/binary_sensor.h"
#include "esphome/components/sensor/sensor.h"
#include "esphome/components/text_sensor/text_sensor.h"
#include "esphome/components/time/real_time_clock.h"

#include <vector>

#ifdef USE_ESP32
#include <esp_gattc_api.h>

namespace esphome {
namespace colmi_ring {

namespace espbt = esphome::esp32_ble_tracker;

static const char *const SERVICE_UUID = "6e40fff0-b5a3-f393-e0a9-e50e24dcca9e";
static const char *const RX_CHAR_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";  // write
static const char *const TX_CHAR_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";  // notify

enum Command : uint8_t {
  CMD_SET_TIME = 1,
  CMD_BATTERY = 3,
  CMD_READ_HEART_RATE = 21,
  CMD_GET_STEP_SOMEDAY = 67,
  CMD_SLEEP = 68,  // experimental, see docs/PROTOCOL.md
};

/** Build a 16-byte [command][payload...][checksum] packet. */
std::vector<uint8_t> make_packet(uint8_t command, const std::vector<uint8_t> &payload = {});

inline uint8_t bcd_to_decimal(uint8_t b) { return ((b >> 4) & 0x0F) * 10 + (b & 0x0F); }
inline uint8_t decimal_to_bcd(uint8_t v) { return ((v / 10) << 4) | (v % 10); }

/**
 * Stateful reassembly of the multi-packet heart-rate log response. Rather
 * than keep the full 288-sample day (as the webapp does, for charting), the
 * firmware only needs a single "current" value, so this just tracks the most
 * recent non-zero sample as packets stream in chronological order.
 */
class HeartRateLogParser {
 public:
  void reset();
  /** Feed one notify packet. Returns true once the log is complete (or empty). */
  bool parse(const uint8_t *packet, uint16_t len);
  bool has_reading() const { return this->latest_reading_ > 0; }
  uint8_t latest_reading() const { return this->latest_reading_; }

 private:
  uint8_t size_{0};
  uint8_t latest_reading_{0};

  void note_sample_(uint8_t sample) {
    if (sample != 0)
      this->latest_reading_ = sample;
  }
};

/** Stateful reassembly of the multi-packet steps/calories/distance log response. */
class StepsLogParser {
 public:
  void reset();
  bool parse(const uint8_t *packet, uint16_t len);
  bool has_data() const { return this->has_data_; }
  uint32_t steps() const { return this->steps_; }
  uint32_t calories() const { return this->calories_; }
  uint32_t distance() const { return this->distance_; }

 private:
  uint8_t index_{0};
  bool new_calorie_protocol_{false};
  bool has_data_{false};
  uint32_t steps_{0};
  uint32_t calories_{0};
  uint32_t distance_{0};
};

/**
 * EXPERIMENTAL sleep log reassembly (command 68). The byte layout for sleep
 * stage/quality isn't conclusively decoded upstream (see docs/PROTOCOL.md).
 * This produces a best-effort "minutes with a non-zero stage byte" estimate,
 * nothing more — treat it as a rough diagnostic, not ground truth.
 */
class SleepLogParser {
 public:
  void reset();
  bool parse(const uint8_t *packet, uint16_t len);
  bool has_data() const { return this->has_data_; }
  uint32_t estimated_minutes() const { return this->minutes_; }

 private:
  uint8_t index_{0};
  bool has_data_{false};
  uint32_t minutes_{0};
};

class ColmiRing : public PollingComponent, public ble_client::BLEClientNode {
 public:
  void loop() override;
  void update() override;
  void dump_config() override;
  void gattc_event_handler(esp_gattc_cb_event_t event, esp_gatt_if_t gattc_if,
                           esp_ble_gattc_cb_param_t *param) override;

  void set_time_source(time::RealTimeClock *time_source) { this->time_source_ = time_source; }
  void set_battery_sensor(sensor::Sensor *s) { this->battery_sensor_ = s; }
  void set_charging_sensor(binary_sensor::BinarySensor *s) { this->charging_sensor_ = s; }
  void set_steps_sensor(sensor::Sensor *s) { this->steps_sensor_ = s; }
  void set_calories_sensor(sensor::Sensor *s) { this->calories_sensor_ = s; }
  void set_distance_sensor(sensor::Sensor *s) { this->distance_sensor_ = s; }
  void set_heart_rate_sensor(sensor::Sensor *s) { this->heart_rate_sensor_ = s; }
  void set_sleep_minutes_sensor(sensor::Sensor *s) { this->sleep_minutes_sensor_ = s; }
  void set_last_sync_sensor(text_sensor::TextSensor *s) { this->last_sync_sensor_ = s; }

 protected:
  enum class SyncState : uint8_t {
    IDLE,
    SETTING_TIME,
    READING_BATTERY,
    READING_HEART_RATE,
    READING_STEPS,
    READING_SLEEP,
  };

  void begin_cycle_();
  void write_packet_(uint8_t command, const std::vector<uint8_t> &payload = {});
  void finish_cycle_();
  void handle_notify_(const uint8_t *data, uint16_t len);
  /**
   * Little-endian epoch-seconds payload for CMD_READ_HEART_RATE, truncated to
   * midnight of `time_source_`'s current day. Deliberately uses the same
   * (possibly local, not strictly UTC) fields we just wrote to the ring via
   * CMD_SET_TIME in this same cycle, so the ring's notion of "today" and this
   * request stay self-consistent regardless of the configured `time:`
   * timezone. For an exact match with docs/PROTOCOL.md's "midnight UTC",
   * configure the `time:` component's timezone as UTC.
   */
  std::vector<uint8_t> heart_rate_request_payload_();

  time::RealTimeClock *time_source_{nullptr};
  sensor::Sensor *battery_sensor_{nullptr};
  binary_sensor::BinarySensor *charging_sensor_{nullptr};
  sensor::Sensor *steps_sensor_{nullptr};
  sensor::Sensor *calories_sensor_{nullptr};
  sensor::Sensor *distance_sensor_{nullptr};
  sensor::Sensor *heart_rate_sensor_{nullptr};
  sensor::Sensor *sleep_minutes_sensor_{nullptr};
  text_sensor::TextSensor *last_sync_sensor_{nullptr};

  uint16_t rx_handle_{0};
  uint16_t tx_handle_{0};

  SyncState state_{SyncState::IDLE};
  uint32_t last_activity_ms_{0};

  HeartRateLogParser heart_rate_parser_;
  StepsLogParser steps_parser_;
  SleepLogParser sleep_parser_;
};

}  // namespace colmi_ring
}  // namespace esphome
#endif
