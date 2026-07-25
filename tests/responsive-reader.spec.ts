import { expect, type Locator, type Page, test } from "@playwright/test";

const BOOK_TITLE = "유리창 너머의 계절";

function isMobileProject(projectName: string) {
  return projectName.startsWith("mobile-");
}

function isMergedDesktopProject(projectName: string) {
  return projectName === "tablet-1024" || projectName === "compact-800";
}

async function selectDesktopSection(
  page: Page,
  projectName: string,
  label: string,
) {
  const navigation = page.getByRole("navigation", {
    name: isMergedDesktopProject(projectName) ? "책 도구 메뉴" : "주요 메뉴",
  });
  await navigation.getByRole("button", { name: label, exact: true }).click();
}

async function openReader(page: Page) {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/");
  await expect(
    page.getByRole("main", { name: `${BOOK_TITLE} 본문` }),
  ).toBeVisible();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await expect(page.locator(".footer-progress > button strong")).not.toContainText(
    "계산 중",
  );
}

async function expectNamedControls(root: Locator) {
  const controls = root.locator("button:visible, input:visible, select:visible");
  const count = await controls.count();

  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    await expect(controls.nth(index)).toHaveAccessibleName(/.+/);
  }
}

async function expectNoHorizontalPageOverflow(page: Page) {
  const measurements = await page.evaluate(() => ({
    body: document.body.scrollWidth - window.innerWidth,
    document: document.documentElement.scrollWidth - window.innerWidth,
    shell:
      (document.querySelector<HTMLElement>(".app-shell")?.scrollWidth ?? 0) -
      (document.querySelector<HTMLElement>(".app-shell")?.clientWidth ?? 0),
    pageContent:
      document.querySelector(".reader-viewport")?.classList.contains("is-paged")
        ? (document.querySelector<HTMLElement>(".reader-document")
            ?.scrollHeight ?? 0) -
          (document.querySelector<HTMLElement>(".reader-document")
            ?.clientHeight ?? 0)
        : 0,
  }));

  expect(measurements.document).toBeLessThanOrEqual(1);
  expect(measurements.body).toBeLessThanOrEqual(1);
  expect(measurements.shell).toBeLessThanOrEqual(1);
  expect(measurements.pageContent).toBeLessThanOrEqual(2);
}

async function expectNoPartiallyClippedPagedLine(page: Page) {
  await expect
    .poll(async () =>
      page.locator(".reader-viewport.is-paged").evaluate((viewport) => {
        const documentElement =
          viewport.querySelector<HTMLElement>(".reader-document");
        if (!documentElement) return Number.POSITIVE_INFINITY;
        const documentBottom =
          documentElement.getBoundingClientRect().bottom;
        let clippedLines = 0;

        for (const paragraph of documentElement.querySelectorAll("p")) {
          const range = document.createRange();
          range.selectNodeContents(paragraph);
          for (const rect of range.getClientRects()) {
            if (rect.height > 0 && rect.bottom > documentBottom - 0.1) {
              clippedLines += 1;
            }
          }
          range.detach();
        }

        return clippedLines;
      }),
    )
    .toBe(0);
}

async function openMore(page: Page) {
  await page.getByRole("button", { name: "더보기", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "읽기 도구" });
  await expect(dialog.getByRole("heading", { name: "더보기" })).toBeVisible();
  return dialog;
}

async function openScreenSettings(page: Page) {
  const dialog = await openMore(page);
  await dialog.getByRole("button", { name: /화면 설정/ }).click();
  await expect(
    dialog.getByRole("heading", { name: "화면 설정" }),
  ).toBeVisible();
  return dialog;
}

test.beforeEach(async ({ page }) => {
  await openReader(page);
});

test("approved responsive reader shell remains visually stable", async ({
  page,
}) => {
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await expect(page.locator(".app-shell")).toHaveScreenshot(
    "reader-shell.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.005,
    },
  );
});

test("responsive shell exposes the expected navigation and named controls", async ({
  page,
}, testInfo) => {
  const reader = page.getByRole("main", { name: `${BOOK_TITLE} 본문` });
  await expect(reader.getByRole("heading", { name: BOOK_TITLE })).toBeVisible();
  await expect(page.getByLabel("최근 책 전환")).toHaveValue("novelier-welcome");

  if (isMobileProject(testInfo.project.name)) {
    const toolbar = page.getByRole("navigation", { name: "읽기 도구" });
    await expect(toolbar).toBeVisible();
    await expect(toolbar.getByRole("button")).toHaveCount(5);

    for (const label of ["이동", "북마크", "밝기 설정", "글꼴", "테마"]) {
      await expect(
        toolbar.getByRole("button", { name: label, exact: true }),
      ).toBeVisible();
    }

    await expect(
      page.getByRole("button", { name: "서재로 돌아가기" }),
    ).toBeVisible();
  } else {
    await expect(
      page.getByRole("banner").getByText("NOVELIER", { exact: true }),
    ).toBeVisible();
    const navigation = page.getByRole("navigation", {
      name: isMergedDesktopProject(testInfo.project.name)
        ? "책 도구 메뉴"
        : "주요 메뉴",
    });
    await expect(navigation).toBeVisible();

    for (const label of ["내 서재", "페이지 이동", "북마크", "읽기 설정"]) {
      await expect(
        navigation.getByRole("button", { name: label, exact: true }),
      ).toBeVisible();
    }

    await expect(
      page.getByRole("button", { name: "몰래보기 시작", exact: true }),
    ).toBeVisible();
    if (testInfo.project.name === "desktop-1280") {
      await expect(page.locator(".primary-navigation .primary-bottom")).toHaveCount(
        0,
      );
      await expect(
        page.locator(".primary-navigation").getByRole("button"),
      ).toHaveCount(4);
    }

    for (const label of ["최소화", "최대화 또는 복원", "창 닫기"]) {
      await expect(page.getByRole("button", { name: label })).toBeVisible();
    }
  }

  await expectNamedControls(page.locator(".app-shell"));
  await expectNoHorizontalPageOverflow(page);
});

test("page movement and bookmarks remain operable at each breakpoint", async ({
  page,
}, testInfo) => {
  const mobile = isMobileProject(testInfo.project.name);
  const runtimeErrors: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /maximum update depth|too many re-renders/iu.test(message.text())
    ) {
      runtimeErrors.push(message.text());
    }
  });

  if (mobile) {
    await page
      .getByRole("navigation", { name: "읽기 도구" })
      .getByRole("button", { name: "이동", exact: true })
      .click();
  } else {
    await selectDesktopSection(
      page,
      testInfo.project.name,
      "페이지 이동",
    );
  }

  const jumpRoot = mobile
    ? page.getByRole("dialog", { name: "읽기 도구" })
    : page.getByRole("complementary", { name: "책 도구" });
  await expect(
    jumpRoot.getByRole("heading", { name: "페이지 이동" }),
  ).toBeVisible();
  await expect(jumpRoot.getByRole("slider", { name: "읽기 위치" })).toHaveAttribute(
    "aria-valuetext",
    /퍼센트$/,
  );

  if (mobile) {
    await jumpRoot.getByRole("button", { name: "닫기" }).click();
  }

  const footerProgress = page.getByRole("slider", { name: "읽기 진행률" });
  const progressBefore = Number(await footerProgress.inputValue());
  await page.getByRole("main", { name: `${BOOK_TITLE} 본문` }).focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => Number(await footerProgress.inputValue()))
    .toBeGreaterThan(progressBefore);
  const pageStatus = page.locator(".footer-progress > button strong");
  await expect(pageStatus).toContainText(/^2 \//u);

  if (!mobile) {
    await page.locator(".page-tap-button.next").click();
    await expect(pageStatus).toContainText(/^3 \//u);
    await page.locator(".page-tap-button.previous").click();
    await expect(pageStatus).toContainText(/^2 \//u);
    await page
      .locator(".desktop-page-buttons")
      .getByRole("button", { name: "다음 페이지" })
      .click();
    await expect(pageStatus).toContainText(/^3 \//u);
  }

  const bookmarkToggle = page.getByRole("button", {
    name: "현재 위치 북마크",
  });
  await bookmarkToggle.click();
  await expect(
    page.getByRole("button", { name: "현재 북마크 제거" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("status")).toContainText("현재 위치를 저장했습니다.");

  if (mobile) {
    await expect(page.getByRole("status")).toBeHidden({ timeout: 4_000 });
    await page
      .getByRole("navigation", { name: "읽기 도구" })
      .getByRole("button", { name: "북마크", exact: true })
      .click();
  } else {
    await selectDesktopSection(page, testInfo.project.name, "북마크");
  }

  const bookmarkRoot = mobile
    ? page.getByRole("dialog", { name: "읽기 도구" })
    : page.getByRole("complementary", { name: "책 도구" });
  await expect(
    bookmarkRoot.getByRole("heading", { name: "북마크" }),
  ).toBeVisible();
  await expect(bookmarkRoot.locator(".bookmark-row")).toHaveCount(2);
  expect(runtimeErrors).toEqual([]);
  await expectNoHorizontalPageOverflow(page);
});

test("search and focus mode work without losing reader chrome recovery", async ({
  page,
}, testInfo) => {
  const mobile = isMobileProject(testInfo.project.name);

  if (mobile) {
    const moreDialog = await openMore(page);
    await expect(
      moreDialog.getByRole("button", { name: /책 정보/ }),
    ).toBeVisible();
    await moreDialog
      .getByRole("button", { name: /본문 검색/ })
      .click();
  } else {
    await page.getByRole("button", { name: "검색", exact: true }).click();
  }

  const searchDialog = page.getByRole("dialog", { name: "읽기 도구" });
  const search = searchDialog.getByPlaceholder("단어나 문장 검색");
  await search.fill("계절");
  await expect(searchDialog.getByRole("heading", { name: "본문 검색" })).toBeVisible();
  await expect(searchDialog.locator(".search-results button")).not.toHaveCount(0);
  await searchDialog.locator(".search-results button").first().click();
  await expect(searchDialog).toBeHidden();

  const moreDialog = await openMore(page);
  await moreDialog.getByRole("button", { name: /집중 모드/ }).click();

  for (const selector of [
    ".reader-header",
    ".reader-footer",
    ...(mobile ? [".mobile-toolbar"] : []),
  ]) {
    await expect(page.locator(selector)).toHaveClass(/is-hidden/);
    await expect(page.locator(selector)).toHaveCSS("pointer-events", "none");
  }
  if (!mobile) {
    await expect(page.locator(".desktop-titlebar")).toBeHidden();
    await expect(page.locator(".primary-navigation")).toBeHidden();
    await expect(page.locator(".context-panel")).toBeHidden();
  }

  const reader = page.getByRole("main", { name: `${BOOK_TITLE} 본문` });
  const bounds = await reader.boundingBox();
  expect(bounds).not.toBeNull();
  await reader.click({
    position: {
      x: Math.max(1, (bounds?.width ?? 390) / 2),
      y: Math.max(1, (bounds?.height ?? 480) / 2),
    },
  });
  await expect(page.locator(".reader-header")).toHaveClass(/is-hidden/);
  await expect(page.locator(".reader-footer")).toHaveClass(/is-hidden/);
  if (mobile) {
    await expect(page.locator(".mobile-toolbar")).toHaveClass(/is-hidden/);
  }
  await reader.click({
    position: {
      x: Math.max(1, (bounds?.width ?? 390) * 0.9),
      y: Math.max(1, (bounds?.height ?? 480) / 2),
    },
  });
  await expect(page.locator(".reader-header")).toHaveClass(/is-hidden/);

  await page
    .getByRole("button", { name: "상단 읽기 도구 표시" })
    .click();
  await expect(page.locator(".reader-header")).not.toHaveClass(/is-hidden/);
  await expect(page.locator(".reader-footer")).not.toHaveClass(/is-hidden/);
  if (mobile) {
    await expect(page.locator(".mobile-toolbar")).not.toHaveClass(/is-hidden/);
  } else {
    await expect(page.locator(".desktop-titlebar")).toBeVisible();
    await expect(page.locator(".context-panel")).toBeVisible();
  }

  await page.keyboard.press("Control+Shift+F");
  await expect(page.locator(".reader-header")).toHaveClass(/is-hidden/);
  await page
    .getByRole("button", { name: "하단 읽기 도구 표시" })
    .click();
  await expect(page.locator(".reader-header")).not.toHaveClass(/is-hidden/);

  await page.keyboard.press("Control+Shift+F");
  await page.keyboard.press("Control+Shift+0");
  await expect(page.locator(".reader-header")).not.toHaveClass(/is-hidden/);
  await expect(page.locator(".app-shell")).not.toHaveClass(/is-transparent/);
});

test("reader switches between horizontal pages and vertical scrolling", async ({
  page,
}, testInfo) => {
  const mobile = isMobileProject(testInfo.project.name);

  if (mobile) {
    await page
      .getByRole("navigation", { name: "읽기 도구" })
      .getByRole("button", { name: "글꼴", exact: true })
      .click();
  } else {
    await selectDesktopSection(
      page,
      testInfo.project.name,
      "읽기 설정",
    );
  }

  const settingsRoot = mobile
    ? page.getByRole("dialog", { name: "읽기 도구" })
    : page.getByRole("complementary", { name: "책 도구" });
  await expect(
    settingsRoot.getByRole("heading", { name: "읽기 설정" }),
  ).toBeVisible();

  await settingsRoot
    .getByRole("button", { name: "가로 페이지", exact: true })
    .click();
  await expect(
    page.getByRole("main", { name: `${BOOK_TITLE} 본문` }),
  ).toHaveClass(/is-paged/);

  await settingsRoot
    .getByRole("button", { name: "세로 스크롤", exact: true })
    .click();
  await expect(
    page.getByRole("main", { name: `${BOOK_TITLE} 본문` }),
  ).toHaveClass(/is-scrolling/);
  await expectNoHorizontalPageOverflow(page);
});

test("Android volume buttons move one reading unit only in the active reader", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile-390",
    "The Android hardware bridge contract needs one phone-sized run.",
  );

  await page.evaluate(() => {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (Linux; Android 16) NOVELIER",
    });
    Object.assign(window, {
      __NOVELIER_CAPTURED__: false,
      __NOVELIER_DARK_BARS__: false,
      NOVELIER_READER_HARDWARE: {
        setVolumeCaptureEnabled(enabled: boolean) {
          Object.assign(window, { __NOVELIER_CAPTURED__: enabled });
        },
        getDisplayName() {
          return "테스트 소설.txt";
        },
        getSystemInsets() {
          return JSON.stringify({ top: 0, right: 0, bottom: 0, left: 0 });
        },
        setDarkSystemBars(enabled: boolean) {
          Object.assign(window, { __NOVELIER_DARK_BARS__: enabled });
        },
      },
    });
    window.dispatchEvent(new Event("novelier:android-bridge-ready"));
  });

  const toolbar = page.getByRole("navigation", { name: "읽기 도구" });
  await toolbar.getByRole("button", { name: "글꼴", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "읽기 도구" });
  await sheet
    .getByRole("checkbox", { name: /음량 버튼으로 페이지 넘기기/ })
    .check();
  await sheet.getByRole("button", { name: "닫기" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __NOVELIER_CAPTURED__?: boolean })
            .__NOVELIER_CAPTURED__,
      ),
    )
    .toBe(true);

  const reader = page.getByRole("main", { name: `${BOOK_TITLE} 본문` });
  const emitVolumeNavigation = (
    source: "volume-up" | "volume-down",
    direction: "backward" | "forward",
  ) =>
    page.evaluate(
      ({ eventSource, eventDirection }) => {
        window.dispatchEvent(
          new CustomEvent("novelier:hardware-reader-navigation", {
            detail: {
              version: 1,
              source: eventSource,
              direction: eventDirection,
              repeat: false,
            },
          }),
        );
      },
      { eventSource: source, eventDirection: direction },
    );

  const firstPage = await reader.getAttribute("data-page-current");
  await emitVolumeNavigation("volume-down", "forward");
  await expect
    .poll(() => reader.getAttribute("data-page-current"))
    .not.toBe(firstPage);

  await toolbar.getByRole("button", { name: "테마", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __NOVELIER_CAPTURED__?: boolean })
            .__NOVELIER_CAPTURED__,
      ),
    )
    .toBe(false);
  const pageWhileSheetOpen = await reader.getAttribute("data-page-current");
  await emitVolumeNavigation("volume-down", "forward");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await expect(reader).toHaveAttribute(
    "data-page-current",
    pageWhileSheetOpen ?? "1",
  );
  await sheet.getByRole("button", { name: "닫기" }).click();

  await emitVolumeNavigation("volume-up", "backward");
  await expect(reader).toHaveAttribute(
    "data-page-current",
    firstPage ?? "1",
  );

  await toolbar.getByRole("button", { name: "글꼴", exact: true }).click();
  await sheet
    .getByRole("button", { name: "세로 스크롤", exact: true })
    .click();
  await sheet.getByRole("button", { name: "닫기" }).click();
  await expect(reader).toHaveClass(/is-scrolling/);

  const progress = page.getByRole("slider", { name: "읽기 진행률" });
  const progressBefore = Number(await progress.inputValue());
  await emitVolumeNavigation("volume-down", "forward");
  await expect
    .poll(async () => Number(await progress.inputValue()))
    .toBeGreaterThan(progressBefore);

  await toolbar.getByRole("button", { name: "글꼴", exact: true }).click();
  const fontSize = sheet.getByRole("slider", { name: "글자 크기" });
  await expect(fontSize).toHaveAttribute("min", "8");
  await fontSize.fill("8");
  await expect(page.locator(".reader-document")).toHaveCSS("font-size", "8px");
  await expect(
    sheet.getByRole("button", { name: "초기화", exact: true }),
  ).toHaveCount(0);
  await sheet.getByRole("button", { name: "닫기" }).click();

  await toolbar.getByRole("button", { name: "테마", exact: true }).click();
  await sheet.getByRole("button", { name: "다크", exact: true }).click();
  await expect(page.locator(".app-shell")).toHaveAttribute(
    "data-theme",
    "dark",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __NOVELIER_DARK_BARS__?: boolean })
            .__NOVELIER_DARK_BARS__,
      ),
    )
    .toBe(true);
  await sheet.getByRole("button", { name: "닫기" }).click();

  const more = await openMore(page);
  const reset = more.getByRole("button", {
    name: /읽기 설정 초기화/,
  });
  page.once("dialog", (dialog) => dialog.dismiss());
  await reset.click();
  await expect(page.locator(".app-shell")).toHaveAttribute(
    "data-theme",
    "dark",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await reset.click();
  await expect(page.locator(".app-shell")).toHaveAttribute(
    "data-theme",
    "light",
  );
  await expect(more).toBeHidden();
  await expect(reader).toHaveClass(/is-paged/);
  await toolbar.getByRole("button", { name: "글꼴", exact: true }).click();
  await expect(sheet.getByRole("slider", { name: "글자 크기" })).toHaveValue(
    "18",
  );
  await expect(
    sheet.getByRole("checkbox", { name: /음량 버튼으로 페이지 넘기기/ }),
  ).toBeChecked();
});

test("Android system navigation never covers horizontal-page controls", async ({
  page,
}, testInfo) => {
  test.skip(
    !isMobileProject(testInfo.project.name),
    "System navigation clearance applies to phone layouts.",
  );

  const viewportHeight = page.viewportSize()?.height ?? 0;
  const viewportWidth = page.viewportSize()?.width ?? 0;
  const toolbarBaseHeight = viewportHeight <= 520 ? 58 : 82;
  const reader = page.getByRole("main", { name: `${BOOK_TITLE} 본문` });
  const toolbar = page.getByRole("navigation", { name: "읽기 도구" });
  const themeButton = toolbar.getByRole("button", {
    name: "테마",
    exact: true,
  });
  const readerFooter = page.locator(".reader-footer");
  const progressInfo = readerFooter.locator(".footer-progress > button");

  await expect(reader).toHaveClass(/is-paged/);
  for (const bottom of [0, 16, 24, 48, 64]) {
    await page.evaluate((inset) => {
      document.documentElement.dataset.mobileOs = "android";
      document.documentElement.dataset.androidInsetsReady = "true";
      document.documentElement.style.setProperty(
        "--android-safe-area-bottom",
        `${inset}px`,
      );
    }, bottom);

    const toolbarBounds = await toolbar.boundingBox();
    const themeButtonBounds = await themeButton.boundingBox();
    const footerBounds = await readerFooter.boundingBox();
    const progressInfoBounds = await progressInfo.boundingBox();
    const readerClearance = Math.max(bottom, 48) + 12;

    expect(
      (toolbarBounds?.y ?? 0) + (toolbarBounds?.height ?? 0),
    ).toBeLessThanOrEqual(viewportHeight + 1);
    expect(
      (themeButtonBounds?.y ?? 0) + (themeButtonBounds?.height ?? 0),
    ).toBeLessThanOrEqual(viewportHeight - readerClearance + 1);
    expect(
      (footerBounds?.y ?? 0) + (footerBounds?.height ?? 0),
    ).toBeLessThanOrEqual(
      viewportHeight - toolbarBaseHeight - readerClearance + 1,
    );
    expect(
      (progressInfoBounds?.y ?? 0) + (progressInfoBounds?.height ?? 0),
    ).toBeLessThanOrEqual(
      viewportHeight - toolbarBaseHeight - readerClearance + 1,
    );

    if (viewportHeight > 520) {
      const labelBounds = await themeButton.locator("span").boundingBox();
      expect(
        (labelBounds?.y ?? 0) + (labelBounds?.height ?? 0),
      ).toBeLessThanOrEqual(viewportHeight - readerClearance + 1);
    }
  }

  if (viewportHeight <= 520) {
    for (const side of [0, 16, 24, 48, 64]) {
      await page.evaluate((inset) => {
        document.documentElement.style.setProperty(
          "--android-safe-area-right",
          `${inset}px`,
        );
        document.documentElement.style.setProperty(
          "--android-safe-area-left",
          `${inset}px`,
        );
      }, side);
      const progressInfoBounds = await progressInfo.boundingBox();
      const toolbarButtons = toolbar.getByRole("button");
      const firstButtonBounds = await toolbarButtons.first().boundingBox();
      const lastButtonBounds = await toolbarButtons.last().boundingBox();
      const readerSideClearance = Math.max(side, 48) + 12;

      expect(progressInfoBounds?.x ?? 0).toBeGreaterThanOrEqual(
        readerSideClearance - 1,
      );
      expect(
        (progressInfoBounds?.x ?? 0) + (progressInfoBounds?.width ?? 0),
      ).toBeLessThanOrEqual(viewportWidth - readerSideClearance + 1);
      expect(firstButtonBounds?.x ?? 0).toBeGreaterThanOrEqual(
        readerSideClearance - 1,
      );
      expect(
        (lastButtonBounds?.x ?? 0) + (lastButtonBounds?.width ?? 0),
      ).toBeLessThanOrEqual(viewportWidth - readerSideClearance + 1);
    }
  }

  const focusedBottomInset = 64;
  await page.evaluate((inset) => {
    document.documentElement.style.setProperty(
      "--android-safe-area-bottom",
      `${inset}px`,
    );
  }, focusedBottomInset);
  const readerBoundsBeforeFocus = await reader.boundingBox();
  await reader.click({
    position: {
      x: (readerBoundsBeforeFocus?.width ?? 1) / 2,
      y: (readerBoundsBeforeFocus?.height ?? 1) / 2,
    },
  });
  await expect(page.locator(".app-shell")).toHaveClass(/is-focus-mode/);
  const focusedPagedBounds = await reader.boundingBox();
  const focusedBottomClearance = Math.max(focusedBottomInset, 48) + 12;
  expect(
    (focusedPagedBounds?.y ?? 0) + (focusedPagedBounds?.height ?? 0),
  ).toBeLessThanOrEqual(viewportHeight - focusedBottomClearance + 1);

  await page
    .getByRole("button", { name: "하단 읽기 도구 표시" })
    .click();
  await toolbar.getByRole("button", { name: "글꼴", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "읽기 도구" });
  await sheet
    .getByRole("button", { name: "세로 스크롤", exact: true })
    .click();
  await sheet.getByRole("button", { name: "닫기" }).click();
  await expect(reader).toHaveClass(/is-scrolling/);
  const scrollingBoundsBeforeFocus = await reader.boundingBox();
  await reader.click({
    position: {
      x: (scrollingBoundsBeforeFocus?.width ?? 1) / 2,
      y: (scrollingBoundsBeforeFocus?.height ?? 1) / 2,
    },
  });
  await expect(page.locator(".app-shell")).toHaveClass(/is-focus-mode/);
  const focusedScrollingBounds = await reader.boundingBox();
  expect(
    (focusedScrollingBounds?.y ?? 0) + (focusedScrollingBounds?.height ?? 0),
  ).toBeLessThanOrEqual(viewportHeight - focusedBottomClearance + 1);
});

test("mobile horizontal pages never expose a partially clipped final line", async ({
  page,
}, testInfo) => {
  test.skip(
    !isMobileProject(testInfo.project.name),
    "Line-level mobile pagination applies to phone layouts.",
  );

  await page.evaluate(() => {
    document.documentElement.dataset.mobileOs = "android";
    document.documentElement.dataset.androidInsetsReady = "true";
    document.documentElement.style.setProperty(
      "--android-safe-area-bottom",
      "64px",
    );
  });

  const reader = page.locator(".reader-viewport.is-paged");
  const toolbar = page.getByRole("navigation", { name: "읽기 도구" });
  const verifyAndAdvance = async (pageCount: number) => {
    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      await expect(
        page.locator(".footer-progress > button strong"),
      ).not.toContainText("계산 중");
      await expectNoPartiallyClippedPagedLine(page);
      const bounds = await reader.boundingBox();
      await reader.click({
        position: {
          x: Math.max(1, (bounds?.width ?? 1) * 0.9),
          y: Math.max(1, (bounds?.height ?? 1) * 0.5),
        },
      });
    }
  };

  await verifyAndAdvance(6);

  await toolbar.getByRole("button", { name: "글꼴", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "읽기 도구" });
  await sheet.getByRole("slider", { name: "글자 크기" }).fill("30");
  await sheet.getByRole("slider", { name: "줄 간격" }).fill("2.2");
  await sheet.getByRole("button", { name: "닫기" }).click();

  await verifyAndAdvance(6);

  const bounds = await reader.boundingBox();
  await reader.click({
    position: {
      x: Math.max(1, (bounds?.width ?? 1) * 0.5),
      y: Math.max(1, (bounds?.height ?? 1) * 0.5),
    },
  });
  await expect(page.locator(".app-shell")).toHaveClass(/is-focus-mode/);
  await expectNoPartiallyClippedPagedLine(page);
});

test("desktop simple view and transparent mode remain recoverable", async ({
  page,
}, testInfo) => {
  const shell = page.locator(".app-shell");

  if (isMobileProject(testInfo.project.name)) {
    await expect(
      page.getByRole("button", { name: "몰래보기 시작", exact: true }),
    ).toBeHidden();
    await expect(
      page.getByRole("toolbar", { name: "몰래보기 빠른 설정" }),
    ).toBeHidden();
    await expect(shell).not.toHaveClass(/is-simple-view/);
    await page.keyboard.press("Control+Shift+M");
    await expect(shell).not.toHaveClass(/is-stealth-view/);
    await page.keyboard.press("Control+Shift+P");
    await expect(shell).not.toHaveClass(/is-privacy-mode/);
    await page.keyboard.press("Control+Shift+T");
    await expect(shell).not.toHaveClass(/is-transparent/);
    await page.keyboard.press("Control+Shift+S");
    await expect(shell).not.toHaveClass(/is-simple-view/);
    return;
  }

  const screenDialog = await openScreenSettings(page);
  const simpleView = screenDialog.getByRole("checkbox", {
    name: /간단보기/,
  });
  await expect(simpleView).toBeVisible();
  await simpleView.check();
  await expect(shell).toHaveClass(/is-simple-view/);
  await expect(page.locator(".primary-navigation")).toBeHidden();
  await expect(page.locator(".context-panel")).toBeHidden();

  const backgroundChoices = screenDialog.getByRole("group", {
    name: "PC 배경 농도",
  });
  await expect(backgroundChoices).toBeVisible();
  await screenDialog
    .getByRole("button", { name: "은은", exact: true })
    .click();
  await expect(shell).toHaveClass(/is-transparent/);
  await expect(shell).toHaveCSS(
    "background-color",
    "rgba(252, 252, 251, 0.82)",
  );
  await expect(shell).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
  await expect(shell).toHaveCSS("box-shadow", "none");
  await expect(shell).toHaveCSS("backdrop-filter", "none");
  await expect(page.locator(".desktop-titlebar")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await expect(page.locator(".reader-workspace")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await expect(page.locator(".brightness-scrim")).toBeHidden();
  await expect(page.locator(".reader-document")).toHaveCSS("opacity", "1");
  await screenDialog
    .getByRole("button", { name: "완전", exact: true })
    .click();
  await expect(shell).toHaveCSS(
    "background-color",
    "rgba(252, 252, 251, 0)",
  );
  await expect(page.locator(".reader-document")).toHaveCSS("opacity", "1");
  await screenDialog
    .getByRole("button", { name: "은은", exact: true })
    .click();
  await screenDialog.getByRole("button", { name: "닫기" }).click();

  await page.evaluate(() => document.fonts.ready.then(() => true));
  await expect(shell).toHaveScreenshot("reader-simple-transparent.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.005,
  });

  await page.keyboard.press("Control+Shift+P");
  await expect(shell).not.toHaveClass(/is-privacy-mode/);
  await expect(page.locator(".desktop-titlebar")).toBeVisible();

  await page.keyboard.press("Control+Shift+0");
  await expect(shell).not.toHaveClass(/is-simple-view/);
  await expect(shell).not.toHaveClass(/is-transparent/);
  await expect(page.locator(".context-panel")).toBeVisible();

  await page.keyboard.press("Control+Shift+T");
  await expect(shell).toHaveClass(/is-transparent/);
  await page.keyboard.press("Control+Shift+T");
  await expect(shell).not.toHaveClass(/is-transparent/);

  await page.keyboard.press("Control+Shift+S");
  await expect(shell).toHaveClass(/is-simple-view/);
  await page.keyboard.press("Control+Shift+0");
  await expect(shell).not.toHaveClass(/is-simple-view/);
});

test("desktop stealth view reveals controls only from their reserved edge area", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-1280",
    "The desktop stealth contract needs one desktop engine run.",
  );

  await page.evaluate(() => {
    document.documentElement.dataset.platform = "windows";
  });
  const shell = page.locator(".app-shell");
  const progress = page.getByRole("slider", { name: "읽기 진행률" });
  await progress.fill("370");
  await expect
    .poll(async () => Number(await progress.inputValue()))
    .toBeGreaterThan(0);
  const progressBeforeStealth = await progress.inputValue();

  await page
    .getByRole("button", { name: "몰래보기 시작", exact: true })
    .click();
  await page.setViewportSize({ width: 430, height: 720 });

  await expect(shell).toHaveClass(/is-stealth-view/);
  await expect(page.locator(".desktop-titlebar")).toBeHidden();
  await expect(page.locator(".primary-navigation")).toBeHidden();
  await expect(page.locator(".context-panel")).toBeHidden();
  const quickControlsRegion = page.locator(".stealth-quick-controls");
  await expect(quickControlsRegion).toHaveClass(/is-hidden/);
  await expect(quickControlsRegion).toHaveAttribute("role", "button");
  await expect(page.locator(".reader-header")).toHaveClass(/is-hidden/);
  await expect(page.locator(".reader-footer")).toHaveClass(/is-hidden/);
  await expect(
    page.getByRole("navigation", { name: "읽기 도구" }),
  ).toHaveClass(/is-hidden/);
  await quickControlsRegion.click();
  await expect(
    page.getByRole("button", { name: "서재로 돌아가기" }),
  ).toBeVisible();
  await expect(progress).toHaveValue(progressBeforeStealth);

  const quickControls = page.getByRole("toolbar", {
    name: "몰래보기 빠른 설정",
  });
  await expect(quickControls).toBeVisible();
  const dragHandle = quickControls.locator(".stealth-drag-handle");
  await expect(dragHandle).toBeVisible();
  await expect(dragHandle).toHaveAttribute(
    "data-tauri-drag-region",
    "deep",
  );
  await expect(dragHandle).toContainText("이동");
  await expect(dragHandle.locator("svg")).toBeVisible();
  const dragBounds = await dragHandle.boundingBox();
  expect(dragBounds?.width).toBeGreaterThanOrEqual(44);
  expect(dragBounds?.height).toBeGreaterThanOrEqual(44);
  await expect(
    quickControls.getByRole("button", {
      name: "기본 PC 보기로 돌아가기",
    }),
  ).toBeVisible();
  const quickButtons = quickControls.getByRole("button");
  await expect(quickButtons).toHaveCount(2);
  for (let index = 0; index < (await quickButtons.count()); index += 1) {
    const bounds = await quickButtons.nth(index).boundingBox();
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
  }

  const mobileToolbar = page.getByRole("navigation", { name: "읽기 도구" });
  await expect(mobileToolbar).toBeVisible();
  await expect(mobileToolbar.getByRole("button")).toHaveCount(5);

  await expect(shell).toHaveClass(/is-transparent/);
  await expect(shell).toHaveCSS(
    "background-color",
    "rgba(252, 252, 251, 0.28)",
  );
  const quickOpacity = quickControls.getByRole("slider", {
    name: "몰래보기 배경 농도",
  });
  const opacityControl = quickControls.locator(".stealth-opacity-control");
  await expect(quickOpacity).toHaveValue("28");
  await expect(page.getByRole("slider")).toHaveCount(2);
  await expect(progress).toBeVisible();
  await expect(opacityControl).toHaveCSS("opacity", "0.78");

  await quickOpacity.fill("7");
  await expect(shell).toHaveCSS(
    "background-color",
    "rgba(252, 252, 251, 0.07)",
  );
  await expect(opacityControl).toHaveCSS("opacity", "0.78");
  await quickOpacity.dispatchEvent("pointerup", { pointerType: "mouse" });
  expect(
    await quickOpacity.evaluate((element) => document.activeElement === element),
  ).toBe(false);
  await page.mouse.move(420, 300);
  await expect(opacityControl).toHaveCSS("opacity", "0.07");

  await quickOpacity.focus();
  await expect(opacityControl).toHaveCSS("opacity", "0.78");
  await quickOpacity.fill("0");
  await quickOpacity.evaluate((element) => element.blur());
  await page.mouse.move(420, 300);
  await expect(shell).toHaveCSS(
    "background-color",
    "rgba(252, 252, 251, 0)",
  );
  await expect(opacityControl).toHaveCSS("opacity", "0.04");

  await quickOpacity.focus();
  await quickOpacity.fill("28");
  await quickOpacity.evaluate((element) => element.blur());
  await page.mouse.move(420, 300);
  await expect(shell).toHaveCSS(
    "background-color",
    "rgba(252, 252, 251, 0.28)",
  );
  await expect(opacityControl).toHaveCSS("opacity", "0.28");

  const readerViewport = page.getByRole("main", {
    name: `${BOOK_TITLE} 본문`,
  });
  const readerHeader = page.locator(".reader-header");
  const readerFooter = page.locator(".reader-footer");
  await expect(readerViewport).toHaveAttribute(
    "data-chrome-toggle-zones",
    "reserved-chrome-only",
  );
  const tapReaderZone = async (
    zone: "left" | "center" | "right",
  ) => {
    const bounds = await readerViewport.boundingBox();
    if (!bounds) throw new Error("Stealth reader viewport must be measurable.");
    const x =
      zone === "left"
        ? 8
        : zone === "right"
          ? Math.max(8, bounds.width - 8)
          : Math.max(8, bounds.width / 2);
    const y = Math.max(8, bounds.height / 2);
    await readerViewport.click({
      position: {
        x,
        y,
      },
    });
  };
  const expectReaderChrome = async (visible: boolean) => {
    for (const chrome of [readerHeader, readerFooter, mobileToolbar]) {
      if (visible) {
        await expect(chrome).not.toHaveClass(/is-hidden/);
      } else {
        await expect(chrome).toHaveClass(/is-hidden/);
        await expect(chrome).toHaveCSS("pointer-events", "none");
      }
    }
    if (visible) {
      await expect(quickControlsRegion).not.toHaveClass(/is-hidden/);
      await expect(quickControlsRegion).toHaveAttribute("role", "toolbar");
    } else {
      await expect(quickControlsRegion).toHaveClass(/is-hidden/);
      await expect(quickControlsRegion).toHaveAttribute("role", "button");
      await expect(quickControlsRegion).toHaveAttribute(
        "aria-label",
        "몰래보기 상단 도구 표시",
      );
      await expect(quickControlsRegion).toHaveCSS("opacity", "0");
      await expect(quickControlsRegion.locator("button, input")).toHaveCount(0);
    }
  };

  const readerDocument = page.locator(".reader-document");
  await expect(readerDocument).toHaveCSS("user-select", "none");
  expect(
    await readerDocument.evaluate((element) =>
      getComputedStyle(element).getPropertyValue("-webkit-user-drag"),
    ),
  ).toBe("none");
  expect(
    await readerDocument.evaluate((element) =>
      element.dispatchEvent(
        new DragEvent("dragstart", {
          bubbles: true,
          cancelable: true,
        }),
      ),
    ),
  ).toBe(false);

  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  const firstParagraph = readerDocument.locator("p").first();
  const paragraphBounds = await firstParagraph.boundingBox();
  if (!paragraphBounds) {
    throw new Error("Visible reader paragraph is required for drag regression.");
  }
  const dragY =
    paragraphBounds.y + Math.min(18, Math.max(1, paragraphBounds.height / 2));
  await page.mouse.move(paragraphBounds.x + 8, dragY);
  await page.mouse.down();
  await page.mouse.move(
    paragraphBounds.x + Math.min(48, paragraphBounds.width - 8),
    dragY,
    { steps: 4 },
  );
  await page.mouse.up();
  expect(
    await page.evaluate(() => window.getSelection()?.toString() ?? ""),
  ).toBe("");
  await expect(readerDocument).toHaveCSS("opacity", "1");
  await expect(
    quickControls.getByRole("button", { name: "창 안전하게 접기" }),
  ).toBeVisible();
  await expect(
    quickControls.getByRole("button", {
      name: "기본 PC 보기로 돌아가기",
    }),
  ).toBeVisible();

  await mobileToolbar
    .getByRole("button", { name: "테마", exact: true })
    .click();
  const themeSheet = page.getByRole("dialog", { name: "읽기 도구" });
  await expect(
    themeSheet.getByRole("heading", { name: "화면 설정" }),
  ).toBeVisible();
  await expect(
    themeSheet.getByRole("checkbox", { name: /간단보기/ }),
  ).toBeHidden();
  const sheetBounds = await themeSheet.boundingBox();
  expect(sheetBounds?.width).toBeGreaterThanOrEqual(420);
  expect((sheetBounds?.y ?? 0) + (sheetBounds?.height ?? 0)).toBeGreaterThan(
    700,
  );
  await themeSheet.getByRole("button", { name: "닫기" }).click();

  await page.evaluate(() => document.fonts.ready.then(() => true));
  await expect(shell).toHaveScreenshot("reader-stealth-view.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.005,
  });

  const initialPage = Number(
    await readerViewport.getAttribute("data-page-current"),
  );
  await tapReaderZone("right");
  await expect
    .poll(async () =>
      Number(await readerViewport.getAttribute("data-page-current")),
    )
    .toBe(initialPage + 1);
  await expectReaderChrome(true);
  await tapReaderZone("left");
  await expect
    .poll(async () =>
      Number(await readerViewport.getAttribute("data-page-current")),
    )
    .toBe(initialPage);
  await expectReaderChrome(true);

  await tapReaderZone("center");
  await expectReaderChrome(false);
  await tapReaderZone("center");
  await expectReaderChrome(false);
  const hiddenPage = Number(
    await readerViewport.getAttribute("data-page-current"),
  );
  await tapReaderZone("right");
  await expect
    .poll(async () =>
      Number(await readerViewport.getAttribute("data-page-current")),
    )
    .toBe(hiddenPage + 1);
  await expectReaderChrome(false);
  await tapReaderZone("left");
  await expect
    .poll(async () =>
      Number(await readerViewport.getAttribute("data-page-current")),
    )
    .toBe(hiddenPage);
  await expectReaderChrome(false);
  await page
    .getByRole("button", { name: "하단 읽기 도구 표시" })
    .click();
  await expectReaderChrome(true);
  await tapReaderZone("center");
  await expectReaderChrome(false);
  await quickControlsRegion.click();
  await expectReaderChrome(true);
  const progressAfterTapGestures = await progress.inputValue();

  await quickControls
    .getByRole("button", { name: "기본 PC 보기로 돌아가기" })
    .click();
  await expect(shell).not.toHaveClass(/is-stealth-view/);
  await expect(quickControls).toBeHidden();
  await expect(page.locator(".desktop-titlebar")).toBeVisible();
  await expect(mobileToolbar).toBeHidden();
  await expect(progress).toHaveValue(progressAfterTapGestures);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page
    .getByRole("button", { name: "몰래보기 시작", exact: true })
    .click();
  await expect(shell).toHaveClass(/is-stealth-view/);
  await expect(shell).toHaveCSS(
    "background-color",
    "rgba(252, 252, 251, 0.28)",
  );
  await quickControlsRegion.click();
  await expect(quickOpacity).toHaveValue("28");
  await quickControls
    .getByRole("button", { name: "창 안전하게 접기" })
    .click();
  await expect(shell).not.toHaveClass(/is-stealth-view/);
  await expect(quickControls).toBeHidden();

  await page
    .getByRole("button", { name: "몰래보기 시작", exact: true })
    .click();
  await expect(shell).toHaveClass(/is-stealth-view/);
  await page.keyboard.press("Control+Shift+M");
  await expect(shell).not.toHaveClass(/is-stealth-view/);
  await page.keyboard.press("Control+Shift+M");
  await expect(shell).toHaveClass(/is-stealth-view/);
  const persistedUi = await page.evaluate(() =>
    window.localStorage.getItem("novelier-ui-state-v2"),
  );
  expect(persistedUi ?? "").not.toContain("stealthView");
  expect(persistedUi ?? "").not.toContain("privacyMode");
  await page.reload();
  await expect(shell).not.toHaveClass(/is-stealth-view/);
  await expect(quickControls).toBeHidden();
});

test("native narrow desktop keeps a desktop drawer and simple-view recovery", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-1280",
    "The native narrow-window contract needs one desktop engine run.",
  );

  await page.evaluate(() => {
    document.documentElement.dataset.platform = "windows";
  });
  await page.setViewportSize({ width: 720, height: 560 });

  await expect(page.locator(".desktop-titlebar")).toBeVisible();
  await expect(page.locator(".context-panel")).toBeVisible();
  await expect(page.locator(".mobile-toolbar")).toBeHidden();
  const screenDialog = await openScreenSettings(page);
  const simpleView = screenDialog.getByRole("checkbox", {
    name: /간단보기/,
  });
  await simpleView.check();
  await screenDialog.getByRole("button", { name: "닫기" }).click();
  await expect(page.locator(".context-panel")).toBeHidden();
  await expect(page.locator(".reader-viewport")).toBeVisible();
  await expectNoHorizontalPageOverflow(page);

  const restoreDialog = await openScreenSettings(page);
  await restoreDialog
    .getByRole("checkbox", { name: /간단보기/ })
    .uncheck();
  await restoreDialog.getByRole("button", { name: "닫기" }).click();
  await expect(page.locator(".context-panel")).toBeVisible();
});
