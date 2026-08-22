import { Global, Module } from "@nestjs/common";
import { WorkspaceStateService } from "./workspace-state.service.js";

@Global()
@Module({
  providers: [WorkspaceStateService],
  exports: [WorkspaceStateService]
})
export class WorkspaceStateModule {}
