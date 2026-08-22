import { Module } from "@nestjs/common";
import { CoreController } from "./core.controller.js";
import { CoreService } from "./core.service.js";

@Module({
  controllers: [CoreController],
  providers: [CoreService],
  exports: [CoreService]
})
export class CoreModule {}
