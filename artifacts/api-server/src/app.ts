import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Replit's shared proxy injects X-Forwarded-For. Trust the first hop so that
// express-rate-limit can use the real client IP rather than the proxy's address.
app.set("trust proxy", 1);

// Security headers — sets X-Content-Type-Options, X-Frame-Options,
// Strict-Transport-Security, X-Download-Options, etc. and removes X-Powered-By.
app.use(helmet());

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
// 50 kb cap — generous for all legitimate API calls; blocks megabyte payloads
// that would otherwise be forwarded raw to the Pimlico bundler proxy.
app.use(express.json({ limit: "50kb" }));
app.use(express.urlencoded({ extended: true, limit: "50kb" }));

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

// Bundler proxy: each active bridge sends ~5 UserOp-related calls.
// 300/min per IP supports a few concurrent bridges comfortably.
const bundlerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many bundler requests — please wait a moment." },
});

app.use("/api/attest",       attestLimiter);
app.use("/api/relay",        relayLimiter);
app.use("/api/chains",       chainsLimiter);
app.use("/api/paymaster",    paymasterLimiter);
app.use("/api/oracle",       oracleLimiter);
app.use("/api/bundler",      bundlerLimiter);
app.use("/api", router);

export default app;
