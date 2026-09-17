import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import java.io.PrintWriter;
import java.io.FileWriter;

public class ColmiListFunctions extends GhidraScript {
    @Override
    public void run() throws Exception {
        PrintWriter out = new PrintWriter(new FileWriter(
            "F:/Will/Desktop/Workspace/GitHub/Colmi-Smart-Ring-Tools/.tools/functions_list.txt"));
        FunctionIterator it = currentProgram.getFunctionManager().getFunctions(true);
        int n = 0;
        while (it.hasNext()) {
            Function f = it.next();
            out.println(f.getEntryPoint() + "\t" + f.getName() + "\tbody=" + f.getBody().getNumAddresses());
            n++;
        }
        out.println("TOTAL: " + n);
        out.flush();
        out.close();
        println("Total functions: " + n);
    }
}
