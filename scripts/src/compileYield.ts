/**
 * Compile YieldVault.sol and output ABI + bytecode to stdout as JSON.
 * Run: pnpm --filter @workspace/scripts run compile-yield
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
// @ts-ignore — solc has no bundled types
import solc from "solc";

const __dirname = dirname(fileURLToPath(import.meta.url));

const source = readFileSync(resolve(__dirname, "../../contracts/YieldVault.sol"), "utf8");

const input = {
  language: "Solidity",
  sources: { "YieldVault.sol": { content: source } },
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

const contract = output.contracts["YieldVault.sol"]["YieldVault"];
console.log(
  JSON.stringify({
    abi: contract.abi,
    bytecode: "0x" + contract.evm.bytecode.object,
  }, null, 2)
);
