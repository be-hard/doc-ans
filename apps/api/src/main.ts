import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { AppModule } from "./app.module.js";
import { AllExceptionsFilter } from "./filters/all-exceptions.filter.js";

async function bootstrap() {
  const logger = new Logger("Bootstrap");
  const app = await NestFactory.create(AppModule, { cors: true });
  app.enableCors();
  app.use(json({ limit: "10mb" }));
  app.useGlobalFilters(new AllExceptionsFilter());

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection", reason instanceof Error ? reason.stack : String(reason));
  });

  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception", error.stack);
  });

  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port, "0.0.0.0");
  logger.log(`docs-ans API listening on http://localhost:${port}`);
}

void bootstrap();
