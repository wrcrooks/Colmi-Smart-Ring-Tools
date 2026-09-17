// Find all references (reads/writes/calls) to a fixed list of addresses of
// interest, to locate the consumer of the command queue that
// handler_for_CMD_SLEEP (0x1351d8) enqueues into.
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;
import ghidra.program.model.listing.Function;

import java.io.PrintWriter;
import java.io.FileWriter;

public class ColmiFindXrefs extends GhidraScript {

    static final String[] TARGETS = {
        "0010615c",  // the actual queue struct in RAM (value stored at the 0x1351fc literal pool slot)
        "001351d8",  // the enqueue function itself - who calls it besides the dispatcher?
    };

    @Override
    public void run() throws Exception {
        String outPath = "F:/Will/Desktop/Workspace/GitHub/Colmi-Smart-Ring-Tools/.tools/xref_output.txt";
        PrintWriter out = new PrintWriter(new FileWriter(outPath));

        for (String hex : TARGETS) {
            Address addr = currentProgram.getAddressFactory().getDefaultAddressSpace().getAddress(hex);
            out.println("\n=== References TO 0x" + hex + " ===");
            ReferenceIterator refs = currentProgram.getReferenceManager().getReferencesTo(addr);
            int n = 0;
            while (refs.hasNext()) {
                Reference ref = refs.next();
                Address from = ref.getFromAddress();
                Function f = currentProgram.getFunctionManager().getFunctionContaining(from);
                out.println("  from " + from + " (" + ref.getReferenceType() + ")"
                    + (f != null ? " in function " + f.getName() + "@" + f.getEntryPoint() : " (no function)"));
                n++;
            }
            if (n == 0) out.println("  (none found)");
        }

        out.flush();
        out.close();
        println("Wrote xref results to " + outPath);
    }
}
