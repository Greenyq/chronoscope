import { runScenario } from "./scenario.js";
import { listReplays } from "./store.js";

await runScenario({ shouldFail: false });
await runScenario({ shouldFail: true });

console.log(JSON.stringify({ replays: listReplays() }, null, 2));
