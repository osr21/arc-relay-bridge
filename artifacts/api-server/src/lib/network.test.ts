import assert from "node:assert/strict";
import test from "node:test";
import type { Request, Response } from "express";
import {
  blockedFeatureForPath,
  getNetworkProfile,
  mainnetSafetyGate,
} from "./network";

async function invokeGate(
  path: string,
  method = "GET",
): Promise<{ status: number; body?: unknown; next: boolean }> {
  return new Promise((resolve) => {
    let status = 200;
    const response = {
      status(code: number) {
        status = code;
        return this;
      },
      json(body: unknown) {
        resolve({ status, body, next: false });
      },
    };

    mainnetSafetyGate(
      { path, method } as Request,
      response as unknown as Response,
      () => resolve({ status, next: true }),
    );
  });
}

test("network profile is permanently mainnet-only", () => {
  assert.deepEqual(getNetworkProfile(undefined), {
    environment: "mainnet",
    invalidEnvironment: false,
  });
  assert.deepEqual(getNetworkProfile("not-a-network"), {
    environment: "mainnet",
    invalidEnvironment: false,
  });
});

test("mainnet safety gate normalizes mixed-case and trailing-slash transaction paths", async () => {
  const previous = process.env["ARC_NETWORK_ENV"];
  delete process.env["ARC_NETWORK_ENV"];

  try {
    for (const route of [
      ["/ReLaY/", "relay"],
      ["/rElAy/FeE/", "relay"],
      ["/PAYMASTER/ChAiNs/", "gasless"],
      ["/pAyMaStEr/BaLaNcE/0x0000000000000000000000000000000000000000/", "gasless"],
      ["/BuNdLeR/base-sepolia/", "gasless"],
      ["/gAsReFuEl/QuOtE/", "refuel"],
      ["/GASREFUEL/LIQUIDITY/", "refuel"],
      ["/gasrefuel/SUBMIT/", "refuel"],
      ["/YiElD/RaTeS/", "yield"],
      ["/CoNtRaCtS/", "testnet-data"],
      ["/InDeXeR/StAtS/", "testnet-data"],
      ["/ORACLE/PRICE/", "testnet-data"],
    ]) {
      const [path, feature] = route;
      const result = await invokeGate(path);
      assert.equal(result.status, 503, path);
      assert.equal(result.next, false, path);
      assert.equal((result.body as { code?: string }).code, "MAINNET_NOT_READY", path);
      assert.equal((result.body as { feature?: string }).feature, feature, path);
      assert.equal(blockedFeatureForPath(path), feature, path);
    }
  } finally {
    if (previous === undefined) delete process.env["ARC_NETWORK_ENV"];
    else process.env["ARC_NETWORK_ENV"] = previous;
  }
});

test("mainnet gate default-denies unknown paths and blocked POSTs before body parsing", async () => {
  const previous = process.env["ARC_NETWORK_ENV"];
  delete process.env["ARC_NETWORK_ENV"];

  try {
    // `body` is deliberately absent from the request mock: the gate only needs
    // method/path and is mounted before express.json in app.ts.
    const malformedBodyRoute = await invokeGate("/ReLaY/", "POST");
    assert.equal(malformedBodyRoute.status, 503);
    assert.equal((malformedBodyRoute.body as { code?: string }).code, "MAINNET_NOT_READY");

    const unknownRoute = await invokeGate("/future-money-endpoint/");
    assert.equal(unknownRoute.status, 503);
    assert.equal((unknownRoute.body as { code?: string }).code, "MAINNET_NOT_READY");

    // app.ts mounts this middleware at /api (so Express normally removes that
    // prefix before invoking it). A full, mixed-case API path is still denied
    // defensively if the gate is ever mounted differently.
    const fullApiPath = await invokeGate("/api/ReLaY/", "POST");
    assert.equal(fullApiPath.status, 503);
    assert.equal((fullApiPath.body as { code?: string }).code, "MAINNET_NOT_READY");

    assert.equal((await invokeGate("/ChAiNs/")).next, true);
    assert.equal((await invokeGate("/NeTwOrK-StAtUs/")).next, true);
    assert.equal((await invokeGate("/HeAlThZ/")).next, true);
    assert.equal((await invokeGate("/AtTeSt/")).next, true);
  } finally {
    if (previous === undefined) delete process.env["ARC_NETWORK_ENV"];
    else process.env["ARC_NETWORK_ENV"] = previous;
  }
});
