import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.util.task.ConsoleTaskMonitor;

import java.io.PrintWriter;
import java.io.FileWriter;

public class ColmiSearchDecompiled extends GhidraScript {

    static final String NEEDLE = "10615c";  // search text (case-insensitive) in decompiled pseudocode

    @Override
    public void run() throws Exception {
        PrintWriter out = new PrintWriter(new FileWriter(
            "F:/Will/Desktop/Workspace/GitHub/Colmi-Smart-Ring-Tools/.tools/search_output.txt"));

        DecompInterface decomp = new DecompInterface();
        decomp.openProgram(currentProgram);

        FunctionIterator it = currentProgram.getFunctionManager().getFunctions(true);
        int total = 0;
        int hits = 0;
        int failed = 0;
        while (it.hasNext()) {
            Function f = it.next();
            total++;
            if (total % 50 == 0) {
                println("...progress: " + total + " functions, " + hits + " hits so far");
            }
            DecompileResults res = decomp.decompileFunction(f, 30, new ConsoleTaskMonitor());
            if (res == null || !res.decompileCompleted()) {
                failed++;
                continue;
            }
            String code = res.getDecompiledFunction().getC();
            if (code.toLowerCase().contains(NEEDLE)) {
                hits++;
                out.println("\n================================================================");
                out.println("=== HIT: " + f.getName() + " @ " + f.getEntryPoint());
                out.println("================================================================");
                out.println(code);
            }
        }

        out.println("\n\nSUMMARY: scanned " + total + " functions, " + hits + " matched '" + NEEDLE
            + "', " + failed + " failed to decompile");
        out.flush();
        out.close();
        decomp.dispose();
        println("Scanned " + total + " functions, " + hits + " hits, " + failed + " failed. See search_output.txt");
    }
}
