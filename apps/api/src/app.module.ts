import { Module } from "@nestjs/common";
import { CoreModule } from "./modules/core/core.module";
import { DocumentsModule } from "./modules/documents/documents.module";
import { FilesModule } from "./modules/files/files.module";
import { KnowledgeModule } from "./modules/knowledge/knowledge.module";
import { WorkspaceStateModule } from "./state/workspace-state.module";

@Module({
  imports: [WorkspaceStateModule, CoreModule, DocumentsModule, FilesModule, KnowledgeModule],
  providers: []
})
export class AppModule {}
