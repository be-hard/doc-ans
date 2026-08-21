import { Injectable } from "@nestjs/common";

@Injectable()
export class CoreService {
  health() {
    return { ok: true, service: "docs-ans-api", mode: "beta" };
  }

  login(body: any) {
    const email = String(body?.email ?? "demo@docs-ans.dev");
    const name = String(body?.name ?? "Demo User");
    return {
      token: Buffer.from(`${email}:demo`).toString("base64url"),
      user: { id: "user-demo", email, name }
    };
  }
}
