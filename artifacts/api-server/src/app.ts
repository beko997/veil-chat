import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
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
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

if (process.env.STATIC_DIR) {
  const staticDirectory = path.resolve(process.env.STATIC_DIR);
  app.use(express.static(staticDirectory, { index: false }));
  app.get("/{*splat}", (req, res, next) => {
    if (req.path === "/api" || req.path.startsWith("/api/") || !req.accepts("html")) {
      next();
      return;
    }

    res.sendFile(path.join(staticDirectory, "index.html"), (error) => {
      if (error) next(error);
    });
  });
}

export default app;
