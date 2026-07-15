/**
 * lint-arc-contract — Arc Contract Compatibility Linter (Tool D)
 *
 * Checks Solidity source files for patterns that compile fine on standard EVM
 * but behave incorrectly or revert on Arc Testnet/Mainnet.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run lint-contract -- path/to/Contract.sol
 *   pnpm --filter @workspace/scripts run lint-contract -- contracts/
 *
 * Exit codes: 0 = clean, 1 = issues found, 2 = usage error
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";

// ── Types ────────────────────────────────────────────────────────────────────

type Severity = "error" | "warning" | "info";

interface Issue {
  file: string;
  line: number;
  severity: Severity;
  code: string;
  message: string;
  detail: string;
}

interface CheckResult {
  issues: Issue[];
}

// ── ANSI colours ─────────────────────────────────────────────────────────────

const c = {
  red:    (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan:   (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold:   (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim:    (s: string) => `\x1b[2m${s}\x1b[0m`,
  green:  (s: string) => `\x1b[32m${s}\x1b[0m`,
};

// ── Checks ───────────────────────────────────────────────────────────────────

/**
 * ARC-001 — block.prevrandao / block.difficulty always returns 0 on Arc.
 * Any randomness derived from it is predictable and exploitable.
 */
function checkPrevrandao(lines: string[], file: string): Issue[] {
  const issues: Issue[] = [];
  const pattern = /\bblock\.(prevrandao|difficulty)\b/;
  lines.forEach((line, i) => {
    if (pattern.test(line) && !isComment(line)) {
      issues.push({
        file, line: i + 1, severity: "error", code: "ARC-001",
        message: "`block.prevrandao` / `block.difficulty` always returns 0 on Arc",
        detail:
          "Arc does not use Ethereum's RANDAO beacon. This field is hardcoded to 0, " +
          "making any randomness derived from it trivially predictable. " +
          "Use a VRF oracle (e.g., Pyth Entropy, Chainlink VRF) instead.",
      });
    }
  });
  return issues;
}

/**
 * ARC-002 — PUSH0 opcode (EIP-3855, Shanghai+) is not supported on Arc.
 * Contracts compiled with evmVersion >= "shanghai" will revert on deployment.
 * Arc requires evmVersion: "paris" in Hardhat/Foundry config.
 */
function checkPush0(lines: string[], file: string): Issue[] {
  const issues: Issue[] = [];
  // Check for inline assembly using PUSH0
  const asmPush0 = /\bPUSH0\b/i;
  // Check for pragma indicating a version that defaults to shanghai
  // (solc 0.8.20+ defaults to shanghai unless overridden)
  const pragmaPattern = /pragma\s+solidity\s+[^;]+;/;
  const versionPattern = /0\.8\.(2[0-9]|[3-9]\d|\d{3,})/;

  let hasPush0Asm = false;
  let pragmaLine = -1;
  let pragmaVersion = "";

  lines.forEach((line, i) => {
    if (asmPush0.test(line) && !isComment(line)) {
      hasPush0Asm = true;
      issues.push({
        file, line: i + 1, severity: "error", code: "ARC-002",
        message: "Inline `PUSH0` assembly opcode not supported on Arc",
        detail:
          "Arc targets EVM version 'paris' (pre-Shanghai). PUSH0 (EIP-3855) was " +
          "introduced in Shanghai and is not available. Remove PUSH0 from assembly " +
          "or use `push 0x00` / load a zero literal instead.",
      });
    }
    if (pragmaPattern.test(line) && !isComment(line)) {
      pragmaLine = i + 1;
      pragmaVersion = line.trim();
    }
  });

  if (!hasPush0Asm && pragmaLine > 0 && versionPattern.test(pragmaVersion)) {
    issues.push({
      file, line: pragmaLine, severity: "warning", code: "ARC-002",
      message: `Compiler version may emit PUSH0 by default — set evmVersion: "paris"`,
      detail:
        "solc ≥ 0.8.20 targets EVM Shanghai by default, which emits PUSH0 opcodes. " +
        "Arc (and Arc Testnet) reject PUSH0. Add `evmVersion: 'paris'` to your " +
        "Hardhat/Foundry config, or pin solc to ≤ 0.8.19. " +
        `Detected: ${pragmaVersion.trim()}`,
    });
  }

  return issues;
}

/**
 * ARC-003 — selfdestruct() has non-standard semantics on Arc.
 * Arc emits an EIP-7708 Transfer log on successful SELFDESTRUCT (not standard on Ethereum).
 * Indexers/tests that don't expect this log will miscount balance changes.
 */
function checkSelfdestruct(lines: string[], file: string): Issue[] {
  const issues: Issue[] = [];
  const pattern = /\bselfdestruct\s*\(/;
  lines.forEach((line, i) => {
    if (pattern.test(line) && !isComment(line)) {
      issues.push({
        file, line: i + 1, severity: "warning", code: "ARC-003",
        message: "`selfdestruct()` emits an extra EIP-7708 Transfer log on Arc",
        detail:
          "On Arc, SELFDESTRUCT emits a native USDC Transfer log (from the contract, " +
          "to the beneficiary) in addition to standard EVM effects. Indexers or tests " +
          "that filter Transfer events without expecting this will double-count the " +
          "balance movement. Verify your off-chain accounting handles this correctly.",
      });
    }
  });
  return issues;
}

/**
 * ARC-004 — msg.value decimal confusion.
 * On Arc, msg.value is native USDC at 18 decimals. Comparing it to hardcoded
 * amounts that look like 6-decimal USDC values (e.g., 1_000_000 = $1.00 in ERC-20)
 * will be 10^12 times too small relative to what the user actually sent.
 */
function checkMsgValueDecimals(lines: string[], file: string): Issue[] {
  const issues: Issue[] = [];
  // Look for msg.value comparisons with literals that look like 6-decimal USDC amounts
  // (between 1e4 and 1e10 — common range for dollar amounts in 6 decimals)
  const pattern = /msg\.value\s*[<>=!]+\s*([\d_]+)|([\d_]+)\s*[<>=!]+\s*msg\.value/;
  lines.forEach((line, i) => {
    const match = pattern.exec(line);
    if (match && !isComment(line)) {
      const raw = (match[1] ?? match[2]).replace(/_/g, "");
      const n = BigInt(raw);
      // Flag if the literal looks like a 6-decimal USDC amount (> 0, < 1e12)
      // A proper 18-decimal value for $1 is 1_000_000_000_000_000_000 (1e18)
      if (n > 0n && n < 1_000_000_000_000n) {
        issues.push({
          file, line: i + 1, severity: "error", code: "ARC-004",
          message: "`msg.value` uses 18 decimals on Arc — comparison literal looks like 6-decimal USDC",
          detail:
            `Literal ${raw} is likely a 6-decimal USDC amount (e.g., 1_000_000 = $1.00). ` +
            "On Arc, msg.value is native USDC at 18 decimals: $1.00 = 1_000_000_000_000_000_000. " +
            "A 6-decimal literal is 10¹² times too small and the check will always pass or " +
            "always fail unexpectedly. Convert to 18 decimals or use the ERC-20 interface " +
            "with transferFrom() instead of msg.value.",
        });
      }
    }
  });
  return issues;
}

/**
 * ARC-005 — nonReentrant on validatePaymasterUserOp violates ERC-7562.
 * The _locked storage variable is a global write, which ERC-7562 forbids
 * for unstaked paymasters during UserOp simulation. Pimlico (and other
 * bundlers) silently reject UserOps from such paymasters.
 */
function checkPaymasterReentrant(lines: string[], file: string): Issue[] {
  const issues: Issue[] = [];
  let inValidatePaymaster = false;
  let braceDepth = 0;

  lines.forEach((line, i) => {
    if (/function\s+validatePaymasterUserOp\s*\(/.test(line) && !isComment(line)) {
      inValidatePaymaster = true;
      braceDepth = 0;
    }
    if (inValidatePaymaster) {
      braceDepth += (line.match(/\{/g) ?? []).length;
      braceDepth -= (line.match(/\}/g) ?? []).length;
      if (braceDepth <= 0 && i > 0) inValidatePaymaster = false;

      if (/\bnonReentrant\b/.test(line) && !isComment(line)) {
        issues.push({
          file, line: i + 1, severity: "error", code: "ARC-005",
          message: "`nonReentrant` on `validatePaymasterUserOp` violates ERC-7562",
          detail:
            "ERC-7562 forbids global storage writes (_locked bool) during UserOp " +
            "validation for unstaked paymasters. Bundlers (Pimlico, Alchemy) reject " +
            "such UserOps at simulation time without a clear error message. " +
            "Remove `nonReentrant`; `onlyEntryPoint` is sufficient since the EntryPoint " +
            "never re-enters the validation phase. See ERC-7562 §3.3.",
        });
      }
    }
  });
  return issues;
}

/**
 * ARC-006 — block.timestamp as ordering key.
 * Arc produces ~2 blocks/second. Multiple blocks can share the same
 * block.timestamp at sub-second precision. Using timestamp as a primary
 * sort key or unique ID will produce ordering collisions.
 */
function checkTimestampOrdering(lines: string[], file: string): Issue[] {
  const issues: Issue[] = [];
  // Look for block.timestamp used as a map key, ID, or unique nonce
  const patterns = [
    /mapping\s*\([^)]*uint\d*\s*=>\s*[^)]+\)\s+\w+\s*;\s*\/\/.*timestamp/i,
    /uint\d*\s+\w*(id|nonce|key|index)\w*\s*=\s*block\.timestamp/i,
    /block\.timestamp\s*[+\-]?\s*(==|!=)/,
  ];
  const generalPattern = /block\.timestamp/;

  lines.forEach((line, i) => {
    if (!isComment(line) && patterns.some(p => p.test(line))) {
      issues.push({
        file, line: i + 1, severity: "warning", code: "ARC-006",
        message: "`block.timestamp` used as ordering key — use `block.number` on Arc",
        detail:
          "Arc produces ~2 blocks per second. Multiple consecutive blocks can share " +
          "the same `block.timestamp` (sub-second resolution). Using timestamp as a " +
          "sort key, nonce, or unique identifier will produce collisions. " +
          "Use `block.number` as the primary ordering key instead.",
      });
    }
  });
  return issues;
}

/**
 * ARC-007 — Hardcoded chainId that is not Arc Testnet (5042002) or Arc Mainnet (5042).
 * Contracts that check `block.chainid == 1` (Ethereum mainnet) will silently
 * fail on Arc even in fork tests unless the fork replicates chainId.
 */
function checkHardcodedChainId(lines: string[], file: string): Issue[] {
  const issues: Issue[] = [];
  const ARC_CHAIN_IDS = new Set(["5042002", "5042"]);
  const pattern = /block\.chainid\s*==\s*(\d+)/g;
  lines.forEach((line, i) => {
    if (isComment(line)) return;
    let match: RegExpExecArray | null;
    const re = new RegExp(pattern.source, "g");
    while ((match = re.exec(line)) !== null) {
      const id = match[1];
      if (!ARC_CHAIN_IDS.has(id)) {
        issues.push({
          file, line: i + 1, severity: "warning", code: "ARC-007",
          message: `Hardcoded chainId ${id} will not match Arc (5042002 testnet / 5042 mainnet)`,
          detail:
            `\`block.chainid == ${id}\` always returns false on Arc. ` +
            "If this guard is intended for cross-chain deployment, add Arc's chain ID " +
            "or use a configurable list. Arc Testnet: 5042002. Arc Mainnet: 5042.",
        });
      }
    }
  });
  return issues;
}

/**
 * ARC-008 — Native transfer to address(0) reverts on Arc.
 * On Ethereum, sending ETH to address(0) succeeds (burns the ETH).
 * On Arc, a native USDC transfer to address(0) reverts with
 * "Zero address not allowed" because USDC has blocklist enforcement.
 */
function checkZeroAddressTransfer(lines: string[], file: string): Issue[] {
  const issues: Issue[] = [];
  // payable(address(0)).transfer(...) or address(0).call{value: ...}
  const patterns = [
    /payable\s*\(\s*address\s*\(\s*0\s*\)\s*\)\.transfer/,
    /address\s*\(\s*0\s*\)\.call\s*\{[^}]*value\s*:/,
    /address\s*\(\s*0\s*\)\s*\.\s*transfer\s*\(/,
  ];
  lines.forEach((line, i) => {
    if (!isComment(line) && patterns.some(p => p.test(line))) {
      issues.push({
        file, line: i + 1, severity: "error", code: "ARC-008",
        message: "Native transfer to `address(0)` reverts on Arc",
        detail:
          "Arc enforces the USDC blocklist at the protocol level. A native send " +
          "to address(0) reverts with 'Zero address not allowed'. On Ethereum this " +
          "silently burns ETH. If you intend to burn USDC on Arc, use the ERC-20 " +
          "`burn()` function or send to the designated burn address.",
      });
    }
  });
  return issues;
}

/**
 * ARC-009 — immutable entryPoint in ERC-4337 Paymaster.
 * Using `immutable` for entryPoint produces a 2-immutable (0x60c0) init code
 * pattern that silently reverts on Arc Testnet, Base Sepolia, and Fuji.
 * entryPoint must be a `constant` to stay on the 0x60a0 single-immutable pattern.
 */
function checkImmutableEntryPoint(lines: string[], file: string): Issue[] {
  const issues: Issue[] = [];
  const pattern = /\bimmutable\b[^;]*\bentryPoint\b|\bentryPoint\b[^;]*\bimmutable\b/i;
  lines.forEach((line, i) => {
    if (pattern.test(line) && !isComment(line)) {
      issues.push({
        file, line: i + 1, severity: "error", code: "ARC-009",
        message: "`entryPoint` declared as `immutable` — use `constant` for Arc compatibility",
        detail:
          "A contract with 2 immutable variables uses a 0x60c0 init code pattern that " +
          "silently reverts on Arc, Base Sepolia, and Avalanche Fuji. " +
          "Declare entryPoint as `address public constant ENTRY_POINT = 0x...` " +
          "to keep the contract on the 0x60a0 single-immutable pattern. " +
          "See Arc Paymaster deployment notes in replit.md.",
      });
    }
  });
  return issues;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isComment(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

function collectSolidityFiles(pathArg: string): string[] {
  try {
    const stat = statSync(pathArg);
    if (stat.isDirectory()) {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry);
          if (statSync(full).isDirectory()) walk(full);
          else if (extname(entry) === ".sol") files.push(full);
        }
      };
      walk(pathArg);
      return files;
    }
    return [pathArg];
  } catch {
    console.error(c.red(`Error: path not found: ${pathArg}`));
    process.exit(2);
  }
}

const CHECKS = [
  checkPrevrandao,
  checkPush0,
  checkSelfdestruct,
  checkMsgValueDecimals,
  checkPaymasterReentrant,
  checkTimestampOrdering,
  checkHardcodedChainId,
  checkZeroAddressTransfer,
  checkImmutableEntryPoint,
];

function lintFile(filePath: string): Issue[] {
  let src: string;
  try {
    src = readFileSync(filePath, "utf8");
  } catch {
    console.error(c.red(`Cannot read ${filePath}`));
    return [];
  }
  const lines = src.split("\n");
  return CHECKS.flatMap(check => check(lines, filePath));
}

function severityIcon(s: Severity): string {
  if (s === "error")   return c.red("✖ error  ");
  if (s === "warning") return c.yellow("⚠ warning");
  return c.cyan("ℹ info   ");
}

function printResults(allIssues: Issue[], cwd: string): void {
  const byFile = new Map<string, Issue[]>();
  for (const issue of allIssues) {
    const rel = relative(cwd, issue.file);
    if (!byFile.has(rel)) byFile.set(rel, []);
    byFile.get(rel)!.push(issue);
  }

  for (const [file, issues] of byFile) {
    console.log(`\n${c.bold(file)}`);
    for (const issue of issues) {
      console.log(
        `  ${severityIcon(issue.severity)}  ${c.dim(`line ${issue.line}`)}  ` +
        `${c.bold(issue.code)}  ${issue.message}`
      );
      const wrapped = issue.detail.match(/.{1,90}(\s|$)/g) ?? [issue.detail];
      for (const part of wrapped) {
        console.log(`             ${c.dim(part.trimEnd())}`);
      }
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2).filter(a => !a.startsWith("--"));
  if (args.length === 0) {
    console.error(
      c.bold("arc-lint") + " — Arc Contract Compatibility Linter\n\n" +
      "Usage:\n" +
      "  pnpm --filter @workspace/scripts run lint-contract -- <path/to/Contract.sol>\n" +
      "  pnpm --filter @workspace/scripts run lint-contract -- contracts/\n\n" +
      "Checks:\n" +
      "  ARC-001  block.prevrandao / block.difficulty always returns 0\n" +
      "  ARC-002  PUSH0 opcode (solc ≥0.8.20 without evmVersion: paris)\n" +
      "  ARC-003  selfdestruct() emits extra EIP-7708 Transfer log\n" +
      "  ARC-004  msg.value decimal confusion (18 vs 6 decimals)\n" +
      "  ARC-005  nonReentrant on validatePaymasterUserOp (ERC-7562 violation)\n" +
      "  ARC-006  block.timestamp as ordering key (use block.number)\n" +
      "  ARC-007  Hardcoded chainId that does not match Arc\n" +
      "  ARC-008  Native transfer to address(0) reverts\n" +
      "  ARC-009  immutable entryPoint causes 0x60c0 init revert\n"
    );
    process.exit(2);
  }

  const cwd = process.cwd();
  const files = args.flatMap(collectSolidityFiles);
  if (files.length === 0) {
    console.log(c.yellow("No .sol files found."));
    process.exit(0);
  }

  console.log(c.bold(`\narc-lint`) + c.dim(` — scanning ${files.length} file(s)…`));

  const allIssues = files.flatMap(lintFile);

  if (allIssues.length === 0) {
    console.log(c.green("\n✔ No Arc compatibility issues found.\n"));
    process.exit(0);
  }

  printResults(allIssues, cwd);

  const errors   = allIssues.filter(i => i.severity === "error").length;
  const warnings = allIssues.filter(i => i.severity === "warning").length;

  console.log(
    `\n${c.bold("Summary:")} ` +
    c.red(`${errors} error(s)`) + "  " +
    c.yellow(`${warnings} warning(s)`) +
    `  across ${files.length} file(s)\n`
  );

  process.exit(errors > 0 ? 1 : 0);
}

main();
