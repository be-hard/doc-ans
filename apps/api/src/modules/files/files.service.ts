import { BadRequestException, Inject, Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import { extractPlainText } from "../../infra/file-import.js";
import type { UploadedFile } from "../../infra/upload-file.js";
import { WorkspaceStateService } from "../../state/workspace-state.service.js";

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);

  constructor(@Inject(WorkspaceStateService) private readonly workspace: WorkspaceStateService) {}

  async importFile(file: UploadedFile | undefined, body: any) {
    if (!file) {
      throw new BadRequestException("Missing file");
    }

    try {
      const text = await extractPlainText(file);
      const title = String(body?.title ?? file.originalname.replace(/\.[^.]+$/, ""));
      const document = this.workspace.store.createDocument({
        title,
        contentText: text,
        tags: ["imported"],
        ownerId: "user-demo"
      });
      return { document };
    } catch (error) {
      this.logger.error("Failed to import file", error instanceof Error ? error.stack : undefined);
      if (error instanceof Error && error.message === "暂不支持该文件格式") {
        throw new BadRequestException(error.message);
      }
      throw new InternalServerErrorException("File import failed");
    }
  }
}
