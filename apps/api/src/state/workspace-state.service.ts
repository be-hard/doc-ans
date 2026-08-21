import { Injectable } from "@nestjs/common";
import { InMemoryStore, seedDocuments } from "./store";

@Injectable()
export class WorkspaceStateService {
  // 这层只负责托住一份共享内存状态，具体业务都放到 feature service 里。
  readonly store = new InMemoryStore(seedDocuments());
}
