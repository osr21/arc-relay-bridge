import { Router, type IRouter } from "express";
import healthRouter from "./health";
import attestRouter from "./attest";

const router: IRouter = Router();

router.use(healthRouter);
router.use(attestRouter);

export default router;
