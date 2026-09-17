import { Router, type IRouter } from "express";
import healthRouter     from "./health";
import attestRouter     from "./attest";
import relayRouter      from "./relay";
import chainsRouter     from "./chains";
import yieldRouter      from "./yield";
import paymasterRouter  from "./paymaster";
import oracleRouter     from "./oracle";
import bundlerRouter    from "./bundler";
import gasRefuelRouter  from "./gasrefuel";
import contractsRouter  from "./contracts";
import indexerRouter    from "./indexer";
import networkRouter    from "./network";
import { mainnetSafetyGate } from "../lib/network";

const router: IRouter = Router();

// Keep the route tree fail-closed if it is ever mounted by another server.
// app.ts additionally mounts this before body parsing for the public service.
router.use(mainnetSafetyGate);
router.use(networkRouter);
router.use(healthRouter);
router.use(attestRouter);
router.use(relayRouter);
router.use(chainsRouter);
router.use(yieldRouter);
router.use(paymasterRouter);
router.use(oracleRouter);
router.use(bundlerRouter);
router.use(gasRefuelRouter);
router.use(contractsRouter);
router.use(indexerRouter);

export default router;
