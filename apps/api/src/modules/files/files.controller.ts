import { Body, Controller, Inject, Post, UploadedFile as NestUploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { FilesService } from "./files.service.js";
import type { UploadedFile } from "../../infra/upload-file.js";

@Controller("files")
export class FilesController {
  constructor(@Inject(FilesService) private readonly filesService: FilesService) {}

  @Post("import")
  @UseInterceptors(FileInterceptor("file"))
  importFile(@NestUploadedFile() file: UploadedFile | undefined, @Body() body: any) {
    return this.filesService.importFile(file, body);
  }
}
