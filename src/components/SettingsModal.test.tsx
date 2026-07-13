import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import SettingsModal from "./SettingsModal";

function renderModal(knowledgeAutoAdd: boolean) {
  const onSave = vi.fn();
  render(
    <SettingsModal
      isOpen
      onClose={vi.fn()}
      customApiKey=""
      selectedModel="gemini-3.5-flash"
      customProvider="gemini"
      anthropicAuthToken=""
      anthropicBaseUrl=""
      anthropicModel=""
      thirdPartyApiKey=""
      thirdPartyBaseUrl=""
      thirdPartyModel=""
      thirdPartyThinking={false}
      knowledgeAutoAdd={knowledgeAutoAdd}
      onSave={onSave}
    />,
  );
  return onSave;
}

describe("SettingsModal knowledge checkpoint", () => {
  it("shows the stored auto-add value and saves an explicit opt-out", () => {
    const onSave = renderModal(true);
    const toggle = screen.getByRole("switch", { name: "上传后自动加入知识库" });
    expect(toggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("button", { name: "Apply configuration" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ knowledgeAutoAdd: false }));
  });

  it("syncs the switch when stored settings finish loading before the modal opens", () => {
    const baseProps = {
      onClose: vi.fn(),
      customApiKey: "",
      selectedModel: "gemini-3.5-flash",
      customProvider: "gemini",
      anthropicAuthToken: "",
      anthropicBaseUrl: "",
      anthropicModel: "",
      thirdPartyApiKey: "",
      thirdPartyBaseUrl: "",
      thirdPartyModel: "",
      thirdPartyThinking: false,
      onSave: vi.fn(),
    };
    const view = render(<SettingsModal {...baseProps} isOpen={false} knowledgeAutoAdd />);
    view.rerender(<SettingsModal {...baseProps} isOpen knowledgeAutoAdd={false} />);

    expect(screen.getByRole("switch", { name: "上传后自动加入知识库" }))
      .toHaveAttribute("aria-checked", "false");
  });
});
