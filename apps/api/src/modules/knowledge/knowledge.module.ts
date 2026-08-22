import { Module } from "@nestjs/common";
import { KnowledgeController } from "./knowledge.controller.js";
import { KnowledgeService } from "./knowledge.service.js";
import { WorkspaceStateModule } from "../../state/workspace-state.module.js";

@Module({
  imports: [WorkspaceStateModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService],
  exports: [KnowledgeService]
})
export class KnowledgeModule {}
