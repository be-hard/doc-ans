import { Module } from "@nestjs/common";
import { CoreModule } from "./modules/core/core.module.js";
import { DocumentsModule } from "./modules/documents/documents.module.js";
import { FilesModule } from "./modules/files/files.module.js";
import { KnowledgeModule } from "./modules/knowledge/knowledge.module.js";
import { WorkspaceStateModule } from "./state/workspace-state.module.js";

@Module({
  imports: [WorkspaceStateModule, CoreModule, DocumentsModule, FilesModule, KnowledgeModule],
  providers: []
})
export class AppModule {}
