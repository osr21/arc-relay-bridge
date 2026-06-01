import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Attestation polling: 2 req/5s = ~24/min per active bridge.
// Allow 200/min per IP to support a few concurrent bridges.
const attestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests — please wait a moment and try again." },
});

// Relay endpoint: each call represents one bridge tx mint.
// 20/min per IP is generous — a user bridging continuously hits 1 every few minutes.
const relayLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many relay requests — please wait a moment." },
});

// Chain info polling: fairly liberal, this is a read-only endpoint.
const chainsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests." },
});

// Paymaster balance: 4 parallel RPC calls per request — limit to 30/min per IP.
const paymasterLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many paymaster requests — please wait a moment." },
});

// Oracle price: cached 30s server-side; 60/min per IP is generous.
const oracleLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many oracle requests." },
});

app.use("/api/attest",       attestLimiter);
app.use("/api/relay",        relayLimiter);
app.use("/api/chains",       chainsLimiter);
app.use("/api/paymaster",    paymasterLimiter);
app.use("/api/oracle",       oracleLimiter);
app.use("/api", router);

export default app;
