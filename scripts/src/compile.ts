/**
 * Compile FeeRouter.sol and output ABI + bytecode to stdout as JSON.
 * Run: pnpm --filter @workspace/scripts run compile
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
// @ts-ignore — solc has no bundled types
import solc from "solc";

const __dirname = dirname(fileURLToPath(import.meta.url));

const source = readFileSync(resolve(__dirname, "../../contracts/FeeRouter.sol"), "utf8");

const input = {
  language: "Solidity",
  sources: { "FeeRouter.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));

if (output.errors) {
  for (const e of output.errors) {
    if (e.severity === "error") {
      console.error(e.formattedMessage);
      process.exit(1);
    }
  }
}

const contract = output.contracts["FeeRouter.sol"]["FeeRouter"];
console.log(
  JSON.stringify({
    abi: contract.abi,
    bytecode: "0x" + contract.evm.bytecode.object,
  })
);
