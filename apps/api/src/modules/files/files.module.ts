import { Module } from "@nestjs/common";
import { FilesController } from "./files.controller";
import { FilesService } from "./files.service";
import { WorkspaceStateModule } from "../../state/workspace-state.module";

@Module({
  imports: [WorkspaceStateModule],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService]
})
export class FilesModule {}
