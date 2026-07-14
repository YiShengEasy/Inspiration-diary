import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminInvitePage from "./AdminInvitePage";
import { authFetch } from "../lib/authClient";

vi.mock("../lib/authClient", () => ({ authFetch: vi.fn() }));

const mockedAuthFetch = vi.mocked(authFetch);

describe("AdminInvitePage", () => {
  beforeEach(() => {
    mockedAuthFetch.mockReset();
  });

  it("renders invite records and creates a one-time code", async () => {
    mockedAuthFetch
      .mockResolvedValueOnce(new Response(JSON.stringify({
        inviteCodes: [{
          id: "invite-1",
          code_hint: "A1B2",
          code: "F14A-772D-1D74",
          created_at: Date.now(),
          expires_at: Date.now() + 60_000,
          used_at: null,
          revoked_at: null,
          used_by_email: null,
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ inviteCodes: Array.from({ length: 10 }, (_, index) => ({ code: `F14A-772D-${String(index).padStart(4, "0")}` })) }), { status: 201, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ inviteCodes: [] }), { status: 200, headers: { "Content-Type": "application/json" } }));

    render(<AdminInvitePage onBack={vi.fn()} />);
    expect(await screen.findByText("F14A-772D-1D74")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "一次生成 10 个" }));
    expect(await screen.findByText(/F14A-772D-0000/u)).toBeInTheDocument();
    await waitFor(() => expect(mockedAuthFetch).toHaveBeenCalledWith("/api/admin/invite-codes", { method: "POST" }));
  });
});
