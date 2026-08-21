import { Body, Controller, Get, Inject, Post } from "@nestjs/common";
import { CoreService } from "./core.service";

@Controller()
export class CoreController {
  constructor(@Inject(CoreService) private readonly coreService: CoreService) {}

  @Get("health")
  health() {
    return this.coreService.health();
  }

  @Post("auth/login")
  login(@Body() body: any) {
    return this.coreService.login(body);
  }
}
