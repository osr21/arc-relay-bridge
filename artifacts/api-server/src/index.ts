import app from "./app";
import { logger } from "./lib/logger";
import { startIndexer } from "./workers/indexer";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Start the Arc event indexer only when a database is available
  if (process.env["DATABASE_URL"]) {
    startIndexer().catch((e) =>
      logger.error({ err: e }, "indexer: failed to start")
    );
  } else {
    logger.warn("indexer: DATABASE_URL not set — Arc event indexer will not run");
  }
});
