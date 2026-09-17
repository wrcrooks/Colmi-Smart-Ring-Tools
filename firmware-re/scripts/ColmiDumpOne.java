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

public class ColmiDumpOne extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] addrs = getScriptArgs();
        PrintWriter out = new PrintWriter(new FileWriter(
            "F:/Will/Desktop/Workspace/GitHub/Colmi-Smart-Ring-Tools/.tools/dumpone_output.txt"));

        DecompInterface decomp = new DecompInterface();
        decomp.openProgram(currentProgram);

        for (String hex : addrs) {
            Address addr = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(hex);
            out.println("\n================================================================");
            out.println("=== @ 0x" + hex);
            out.println("================================================================");

            Function func = getFunctionAt(addr);
            if (func == null) func = currentProgram.getFunctionManager().getFunctionContaining(addr);
            if (func == null) {
                try {
                    if (currentProgram.getListing().getInstructionAt(addr) == null) disassemble(addr);
                    func = createFunction(addr, "colmi_" + hex);
                } catch (Exception e) {
                    out.println("createFunction failed: " + e);
                }
            }
            if (func == null) {
                out.println("(no function; raw disasm)");
                InstructionIterator it = currentProgram.getListing().getInstructions(addr, true);
                int n = 0;
                while (it.hasNext() && n < 100) {
                    Instruction insn = it.next();
                    out.println("  " + insn.getAddress() + ": " + insn);
                    n++;
                }
                continue;
            }
            out.println("Function: " + func.getName() + " @ " + func.getEntryPoint() + " size=" + func.getBody().getNumAddresses());
            InstructionIterator it2 = currentProgram.getListing().getInstructions(func.getBody(), true);
            while (it2.hasNext()) {
                Instruction insn = it2.next();
                out.println("  " + insn.getAddress() + ": " + insn);
            }
            out.println("\n-- decompiled --");
            DecompileResults res = decomp.decompileFunction(func, 30, new ConsoleTaskMonitor());
            if (res != null && res.decompileCompleted()) {
                out.println(res.getDecompiledFunction().getC());
            } else {
                out.println("decompile failed: " + (res != null ? res.getErrorMessage() : "null"));
            }
        }
        out.flush();
        out.close();
        decomp.dispose();
        println("done");
    }
}
