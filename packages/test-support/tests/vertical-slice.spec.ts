import { expect, test, type BrowserContext, type Page } from "@playwright/test";

async function redeemAndEnter(context: BrowserContext, invitationUrl: string): Promise<Page> {
  const page = await context.newPage();
  page.on("console", (message) => console.log(`[participant console:${message.type()}] ${message.text()}`));
  page.on("pageerror", (error) => console.log(`[participant pageerror] ${error.message}`));
  await page.goto(invitationUrl);
  await expect(page.getByTestId("participant-identity")).toBeVisible();
  await page.getByTestId("enter-call").click();
  await expect(page.getByTestId("call-status")).toBeVisible();
  return page;
}

test("two independent participants complete an auditable Omni call", async ({ browser, page }, testInfo) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("researcher@omni.local");
  await page.getByLabel("Password").fill("local-only-synthetic-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Experiments" })).toBeVisible();

  await page.getByTestId("create-experiment").click();
  const createdExperiment = page.getByTestId("experiment-list").getByRole("link", {
    name: /Synthetic IP CTS study/,
  }).first();
  await expect(createdExperiment).toBeVisible();
  await createdExperiment.click();

  await page.getByTestId("create-version").click();
  await expect(page.getByTestId("current-version")).toContainText("Current version: 2");
  await page.getByTestId("create-call").click();
  await expect(page.getByTestId("issued-call")).toBeVisible();
  const callId = (await page.getByTestId("issued-call").locator("code").first().textContent())!.trim();
  const callerInvitation = await page.getByTestId("invite-caller").getAttribute("href");
  const calleeInvitation = await page.getByTestId("invite-callee").getAttribute("href");
  expect(callerInvitation).toBeTruthy();
  expect(calleeInvitation).toBeTruthy();

  const callerContext = await browser.newContext({ permissions: ["camera", "microphone"] });
  const calleeContext = await browser.newContext({ permissions: ["camera", "microphone"] });
  const callerPage = await redeemAndEnter(callerContext, callerInvitation!);
  const calleePage = await redeemAndEnter(calleeContext, calleeInvitation!);

  await expect(callerPage.getByTestId("signed-schedule")).toBeVisible();
  await expect(calleePage.getByTestId("signed-schedule")).toBeVisible();
  await expect(callerPage.getByTestId("media-state")).toHaveAttribute("data-connected", "true");
  await expect(calleePage.getByTestId("media-state")).toHaveAttribute("data-connected", "true");
  await expect(callerPage.getByTestId("caption-log")).toContainText(
    "This is synthetic speech for the ACE Omni relay experiment.",
  );
  await expect(calleePage.getByTestId("caption-log")).toContainText(
    "This is synthetic speech for the ACE Omni relay experiment.",
  );

  const callerScreenshot = testInfo.outputPath("caller-active.png");
  const calleeScreenshot = testInfo.outputPath("callee-active.png");
  await callerPage.screenshot({ path: callerScreenshot, fullPage: true });
  await calleePage.screenshot({ path: calleeScreenshot, fullPage: true });
  await testInfo.attach("caller-active", { path: callerScreenshot, contentType: "image/png" });
  await testInfo.attach("callee-active", { path: calleeScreenshot, contentType: "image/png" });

  await callerPage.getByTestId("end-call").click();
  await expect(callerPage.getByTestId("evidence-status")).toContainText("Evidence uploaded");
  await expect(calleePage.getByTestId("evidence-status")).toContainText("Evidence uploaded");

  await page.goto(`/research/calls/${callId}`);
  await expect(page.getByTestId("research-call-state")).toContainText("ended");
  await expect(page.getByTestId("artifact-count")).toContainText("2 artifacts");
  await page.getByTestId("finalize-call").click();
  await expect(page.getByTestId("manifest-ready")).toBeVisible();

  const [manifestDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("manifest-download").click(),
  ]);
  expect(manifestDownload.suggestedFilename()).toContain("manifest-v1.json");
  const [exportDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name: "Download research export" }).click(),
  ]);
  expect(exportDownload.suggestedFilename()).toContain("research-export-v1.json");

  const manifestScreenshot = testInfo.outputPath("research-manifest.png");
  await page.screenshot({ path: manifestScreenshot, fullPage: true });
  await testInfo.attach("research-manifest", { path: manifestScreenshot, contentType: "image/png" });

  await Promise.all([callerContext.close(), calleeContext.close()]);
});
