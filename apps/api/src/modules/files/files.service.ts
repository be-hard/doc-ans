import { Inject, Injectable } from "@nestjs/common";
import { extractPlainText } from "../../infra/file-import";
import type { UploadedFile } from "../../infra/upload-file";
import { WorkspaceStateService } from "../../state/workspace-state.service";

@Injectable()
export class FilesService {
  constructor(@Inject(WorkspaceStateService) private readonly workspace: WorkspaceStateService) {}

  async importFile(file: UploadedFile | undefined, body: any) {
    if (!file) {
      return Promise.reject(new Error("Missing file"));
    }
    const text = await extractPlainText(file);
    const title = String(body?.title ?? file.originalname.replace(/\.[^.]+$/, ""));
    const document = this.workspace.store.createDocument({
      title,
      contentText: text,
      tags: ["imported"],
      ownerId: "user-demo"
    });
    return { document };
  }
}
