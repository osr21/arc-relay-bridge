import { Router, type IRouter } from "express";
import healthRouter from "./health";
import attestRouter from "./attest";
import relayRouter  from "./relay";

const router: IRouter = Router();

router.use(healthRouter);
router.use(attestRouter);
router.use(relayRouter);

export default router;
