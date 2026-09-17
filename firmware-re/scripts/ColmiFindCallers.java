import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;

import java.io.PrintWriter;
import java.io.FileWriter;

public class ColmiFindCallers extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] targets = getScriptArgs();
        PrintWriter out = new PrintWriter(new FileWriter(
            "F:/Will/Desktop/Workspace/GitHub/Colmi-Smart-Ring-Tools/.tools/callers_output.txt"));
        for (String hex : targets) {
            Address addr = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(hex);
            out.println("\n=== Callers of 0x" + hex + " ===");
            ReferenceIterator refs = currentProgram.getReferenceManager().getReferencesTo(addr);
            int n = 0;
            while (refs.hasNext()) {
                Reference ref = refs.next();
                Address from = ref.getFromAddress();
                Function f = currentProgram.getFunctionManager().getFunctionContaining(from);
                out.println("  from " + from + (f != null ? " in " + f.getName() + "@" + f.getEntryPoint() : " (no function)"));
                n++;
            }
            if (n == 0) out.println("  (none found by reference manager)");
        }
        out.flush();
        out.close();
        println("done");
    }
}
