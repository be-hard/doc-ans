import { Body, Controller, Get, Header, HttpCode, Inject, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { KnowledgeService } from "./knowledge.service.js";
import type { AnswerRequest } from "@docs-ans/shared";

@Controller()
export class KnowledgeController {
  constructor(@Inject(KnowledgeService) private readonly knowledgeService: KnowledgeService) { }

  @Post("ai/ask")
  @HttpCode(200)
  @Header("Content-Type", "text/event-stream; charset=utf-8")
  async aiAsk(@Body() body: any, @Res() res: Response) {
    await this.knowledgeService.aiAsk(body, res);
  }

  @Post("knowledge/search")
  searchKnowledge(@Body() body: any) {
    return this.knowledgeService.searchKnowledge(body);
  }

  @Post("knowledge/answer")
  @HttpCode(200)
  @Header("Content-Type", "text/event-stream; charset=utf-8")
  async answerKnowledge(@Body() body: AnswerRequest, @Res() res: Response) {
    await this.knowledgeService.answerKnowledge(body, res);
  }

  @Get("sessions/:sessionId/messages")
  listMessages(@Param("sessionId") sessionId: string) {
    return this.knowledgeService.listMessages(sessionId);
  }
}
