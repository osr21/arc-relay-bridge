import { Router, type IRouter } from "express";
import healthRouter from "./health";
import attestRouter from "./attest";
import relayRouter  from "./relay";
import chainsRouter from "./chains";

const router: IRouter = Router();

router.use(healthRouter);
router.use(attestRouter);
router.use(relayRouter);
router.use(chainsRouter);

export default router;
