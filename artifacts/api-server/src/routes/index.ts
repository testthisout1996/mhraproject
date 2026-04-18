import { Router, type IRouter } from "express";
import healthRouter from "./health";
import mhraRouter from "./mhra";
import statusRouter from "./status";

const router: IRouter = Router();

router.use(healthRouter);
router.use(mhraRouter);
router.use(statusRouter);

export default router;
