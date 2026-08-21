import { Body, Controller, Delete, Get, Inject, Param, Patch, Post } from "@nestjs/common";
import { DocumentsService } from "./documents.service";

@Controller("documents")
export class DocumentsController {
  constructor(@Inject(DocumentsService) private readonly documentsService: DocumentsService) {}

  @Get()
  listDocuments() {
    return this.documentsService.listDocuments();
  }

  @Get(":id")
  getDocument(@Param("id") id: string) {
    return this.documentsService.getDocument(id);
  }

  @Post()
  createDocument(@Body() body: any) {
    return this.documentsService.createDocument(body);
  }

  @Delete(":id")
  deleteDocument(@Param("id") id: string) {
    return this.documentsService.deleteDocument(id);
  }

  @Patch(":id")
  updateDocument(@Param("id") id: string, @Body() body: any) {
    return this.documentsService.updateDocument(id, body);
  }

  @Post(":id/save")
  saveDocument(@Param("id") id: string, @Body() body: any) {
    return this.documentsService.saveDocument(id, body);
  }

  @Get(":id/versions")
  listVersions(@Param("id") id: string) {
    return this.documentsService.listVersions(id);
  }

  @Post(":id/ingest")
  ingestDocument(@Param("id") id: string) {
    return this.documentsService.ingestDocument(id);
  }

  @Post(":id/outgest")
  outgestDocument(@Param("id") id: string) {
    return this.documentsService.outgestDocument(id);
  }

  @Get(":id/ingest-status")
  ingestStatus(@Param("id") id: string) {
    return this.documentsService.ingestStatus(id);
  }
}
