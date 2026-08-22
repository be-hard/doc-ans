import { Module } from "@nestjs/common";
import { FilesController } from "./files.controller.js";
import { FilesService } from "./files.service.js";
import { WorkspaceStateModule } from "../../state/workspace-state.module.js";

@Module({
  imports: [WorkspaceStateModule],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService]
})
export class FilesModule {}
