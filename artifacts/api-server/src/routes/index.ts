import { Router, type IRouter } from "express";
import healthRouter    from "./health";
import attestRouter    from "./attest";
import relayRouter     from "./relay";
import chainsRouter    from "./chains";
import yieldRouter     from "./yield";
import paymasterRouter from "./paymaster";
import oracleRouter    from "./oracle";
import bundlerRouter   from "./bundler";

const router: IRouter = Router();

router.use(healthRouter);
router.use(attestRouter);
router.use(relayRouter);
router.use(chainsRouter);
router.use(yieldRouter);
router.use(paymasterRouter);
router.use(oracleRouter);
router.use(bundlerRouter);

export default router;
