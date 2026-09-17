import assert from "node:assert/strict";
import test from "node:test";
import {
  MAINNET_CHAINS,
  MAINNET_IRIS_API,
  MAINNET_RELEASE,
  assertMainnetFeatureEnabled,
  isMainnetChainId,
  type MainnetFeature,
} from "./mainnet";

test("mainnet network profile contains exactly Arc and Base with correct native/token units", () => {
  assert.deepEqual(Object.values(MAINNET_CHAINS).map((chain) => chain.id), [5042, 8453]);
  for (const chain of Object.values(MAINNET_CHAINS)) {
    assert.equal(Number.parseInt(chain.hexId, 16), chain.id);
    assert.equal(chain.nativeCurrency.decimals, 18);
    assert.equal(chain.cctpVersion, 2);
    assert.equal(chain.minFinalityThreshold, 2000);
    assert(!chain.rpcUrl.includes("testnet") && !chain.rpcUrl.includes("sepolia"));
    assert(!("gasRelayerAddress" in chain));
  }
  assert.equal(MAINNET_CHAINS.ARC_MAINNET.nativeCurrency.symbol, "USDC");
  assert.equal(MAINNET_CHAINS.BASE_MAINNET.nativeCurrency.symbol, "ETH");
  assert.equal(MAINNET_CHAINS.ARC_MAINNET.cctpDomain, 26);
  assert.equal(MAINNET_CHAINS.BASE_MAINNET.cctpDomain, 6);
});

test("only Arc and Base mainnet IDs are accepted", () => {
  for (const chainId of [5042002, 84532, 11155111, 43113, NaN]) {
    assert.equal(isMainnetChainId(chainId), false);
  }
  assert.equal(isMainnetChainId(5042), true);
  assert.equal(isMainnetChainId(8453), true);
  assert.equal(MAINNET_IRIS_API, "https://iris-api.circle.com");
  assert.equal(isMainnetChainId(5042), true);
});

test("mainnet release enables only standard bridge", () => {
  assert.equal(MAINNET_RELEASE.live, true);
  assert.equal(MAINNET_RELEASE.stage, "live");
  assert.equal(MAINNET_RELEASE.features.bridge.enabled, true);
  for (const feature of ["relay", "gasless", "refuel", "yield"] as MainnetFeature[]) {
    assert.equal(MAINNET_RELEASE.features[feature].enabled, false);
    assert.throws(() => assertMainnetFeatureEnabled(feature));
  }
  assert.match(MAINNET_RELEASE.features.yield.reason, /real yield strategy/);
});