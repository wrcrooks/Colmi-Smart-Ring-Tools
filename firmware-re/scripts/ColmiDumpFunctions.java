// Headless Ghidra post-script: decompile a fixed list of addresses of
// interest (BLE command handlers found via manual dispatcher analysis) and
// write both disassembly listing and decompiled C-like pseudocode to a
// results file, so it can be inspected outside the Ghidra GUI.
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.util.task.ConsoleTaskMonitor;

import java.io.PrintWriter;
import java.io.FileWriter;

public class ColmiDumpFunctions extends GhidraScript {

    // address -> label, in hex, matching firmware-re/notes/command-dispatcher.md
    static final String[][] TARGETS = {
        {"00140502", "dispatcher (command byte compare chain)"},
        {"00142364", "handler for CMD_GET_STEP_SOMEDAY (0x43)"},
        {"001351d8", "handler for CMD_SLEEP (0x44), shared with 0x68/0x77/0x80/0xc7"},
        {"001322b0", "handler for CMD_START_REAL_TIME (0x69)"},
        {"00132228", "handler for CMD_STOP_REAL_TIME (0x6a)"},
    };

    @Override
    public void run() throws Exception {
        String outPath = getScriptArgs().length > 0 ? getScriptArgs()[0]
            : "F:/Will/Desktop/Workspace/GitHub/Colmi-Smart-Ring-Tools/.tools/ghidra_output.txt";
        PrintWriter out = new PrintWriter(new FileWriter(outPath));

        DecompInterface decomp = new DecompInterface();
        decomp.openProgram(currentProgram);

        for (String[] target : TARGETS) {
            Address addr = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(target[0]);
            out.println("\n================================================================");
            out.println("=== " + target[1] + " @ 0x" + target[0]);
            out.println("================================================================");

            Function func = getFunctionAt(addr);
            if (func == null) {
                func = currentProgram.getFunctionManager().getFunctionContaining(addr);
            }
            if (func == null) {
                out.println("(no function found - forcing disassembly + createFunction at this address)");
                try {
                    if (currentProgram.getListing().getInstructionAt(addr) == null) {
                        disassemble(addr);
                    }
                    func = createFunction(addr, target[1].replaceAll("[^A-Za-z0-9_]", "_"));
                } catch (Exception e) {
                    out.println("  createFunction failed: " + e);
                }
            }
            if (func == null) {
                out.println("(still no function, disassembling raw instructions instead)");
                Address end = addr.add(0x200);
                InstructionIterator it = currentProgram.getListing().getInstructions(addr, true);
                int count = 0;
                while (it.hasNext() && count < 150) {
                    Instruction insn = it.next();
                    if (insn.getAddress().compareTo(end) > 0) break;
                    out.println("  " + insn.getAddress() + ": " + insn);
                    count++;
                }
                continue;
            }

            out.println("--- Function: " + func.getName() + " @ " + func.getEntryPoint()
                + " size=" + func.getBody().getNumAddresses());

            out.println("\n-- Disassembly --");
            InstructionIterator it = currentProgram.getListing().getInstructions(func.getBody(), true);
            while (it.hasNext()) {
                Instruction insn = it.next();
                out.println("  " + insn.getAddress() + ": " + insn);
            }

            out.println("\n-- Decompiled pseudocode --");
            DecompileResults res = decomp.decompileFunction(func, 60, new ConsoleTaskMonitor());
            if (res != null && res.decompileCompleted()) {
                out.println(res.getDecompiledFunction().getC());
            } else {
                out.println("(decompilation failed: " + (res != null ? res.getErrorMessage() : "null result") + ")");
            }
        }

        decomp.dispose();
        out.flush();
        out.close();
        println("Wrote results to " + outPath);
    }
}
