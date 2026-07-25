import {
  expect,
  type FileChooser,
  type Page,
  test,
} from "@playwright/test";

const SAMPLE_BOOK_TITLE = "유리창 너머의 계절";
const MAX_MOUNTED_PARAGRAPHS = 240;

interface GeneratedBook {
  content: string;
  paragraphOffsets: number[];
}

interface VisibleLocator {
  characterOffset: number;
  paragraph: number;
}

function buildGeneratedBook(
  paragraphCount: number,
  density: "mixed" | "uniform",
): GeneratedBook {
  const paragraphs = Array.from({ length: paragraphCount }, (_, index) => {
    const marker = `P${String(index).padStart(4, "0")}`;
    const body =
      density === "mixed" && index < paragraphCount / 2
        ? "i narrow ".repeat(18)
        : density === "mixed"
          ? "한글너비 ".repeat(22)
          : "virtual paragraph window ".repeat(10);
    return `${marker} ${body.trimEnd()}`;
  });
  const paragraphOffsets: number[] = [];
  let content = "";

  for (const paragraph of paragraphs) {
    if (content) content += "\n\n";
    paragraphOffsets.push(content.length);
    content += paragraph;
  }

  return { content, paragraphOffsets };
}

function paragraphIndexForOffset(offsets: number[], characterOffset: number) {
  let low = 0;
  let high = offsets.length - 1;
  let match = 0;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (offsets[middle] <= characterOffset) {
      match = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return match;
}

async function settleReaderLayout(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      const viewport = document.querySelector<HTMLElement>(".reader-viewport");
      if (!viewport) {
        resolve();
        return;
      }

      let previous = "";
      let stableFrames = 0;
      const sample = () => {
        const next = [
          viewport.clientWidth,
          viewport.clientHeight,
          viewport.scrollWidth,
          viewport.scrollHeight,
          viewport.scrollLeft,
          viewport.scrollTop,
          viewport.querySelectorAll("[data-character-offset]").length,
        ].join(":");
        stableFrames = next === previous ? stableFrames + 1 : 0;
        previous = next;
        if (stableFrames >= 5) {
          resolve();
          return;
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
  });
}

async function openReader(page: Page) {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto("/");
  await expect(
    page.getByRole("main", { name: `${SAMPLE_BOOK_TITLE} 본문` }),
  ).toBeVisible();
}

async function selectDesktopSection(page: Page, label: string) {
  await page
    .getByRole("navigation", { name: "주요 메뉴" })
    .getByRole("button", { name: label, exact: true })
    .click();
}

async function importGeneratedBook(
  page: Page,
  filename: string,
  book: GeneratedBook,
) {
  await selectDesktopSection(page, "내 서재");

  const importButton = page.locator(".context-panel .import-wide-button");
  let chooser: FileChooser | null = null;
  for (let attempt = 0; attempt < 5 && !chooser; attempt += 1) {
    const chooserPromise = page
      .waitForEvent("filechooser", { timeout: 1_000 })
      .catch(() => null);
    await importButton.click();
    chooser = await chooserPromise;
  }
  if (!chooser) {
    throw new Error("The TXT picker did not open after the library became ready.");
  }
  await chooser.setFiles({
    name: filename,
    mimeType: "text/plain",
    buffer: Buffer.from(book.content, "utf8"),
  });

  const title = filename.replace(/\.txt$/iu, "");
  await expect(
    page.getByRole("main", { name: `${title} 본문` }),
  ).toBeVisible();
  await expect(
    page.getByRole("main", { name: `${title} 본문` }).getByRole("heading", {
      name: title,
    }),
  ).toBeVisible();
  await settleReaderLayout(page);
  return title;
}

async function firstVisibleLocator(page: Page): Promise<VisibleLocator | null> {
  return page.locator(".reader-viewport").evaluate((viewport) => {
    const viewportBounds = viewport.getBoundingClientRect();
    const candidates = [
      ...viewport.querySelectorAll<HTMLElement>("[data-character-offset]"),
    ];
    const intersections: Array<{
      characterOffset: number;
      paragraph: number;
      left: number;
      top: number;
    }> = [];

    for (const candidate of candidates) {
      const characterOffset = Number(candidate.dataset.characterOffset);
      const paragraph = Number(candidate.dataset.paragraph);
      if (!Number.isFinite(characterOffset) || !Number.isFinite(paragraph)) {
        continue;
      }

      for (const rect of candidate.getClientRects()) {
        const left = Math.max(rect.left, viewportBounds.left);
        const right = Math.min(rect.right, viewportBounds.right);
        const top = Math.max(rect.top, viewportBounds.top);
        const bottom = Math.min(rect.bottom, viewportBounds.bottom);
        const intersectionWidth = right - left;
        const intersectionHeight = bottom - top;
        if (
          intersectionWidth >= Math.min(24, viewportBounds.width * 0.03) &&
          intersectionHeight >= 4
        ) {
          intersections.push({ characterOffset, paragraph, left, top });
        }
      }
    }

    const isPaged = viewport.classList.contains("is-paged");
    intersections.sort((first, second) =>
      isPaged
        ? first.left - second.left || first.top - second.top
        : first.top - second.top || first.left - second.left,
    );
    const first = intersections[0];
    return first
      ? {
          characterOffset: first.characterOffset,
          paragraph: first.paragraph,
        }
      : null;
  });
}

async function expectVisibleLocator(page: Page) {
  await expect
    .poll(async () => (await firstVisibleLocator(page))?.characterOffset ?? -1)
    .toBeGreaterThanOrEqual(0);
  const locator = await firstVisibleLocator(page);
  expect(locator).not.toBeNull();
  return locator as VisibleLocator;
}

async function jumpToPreset(page: Page, preset: "50%" | "75%") {
  await selectDesktopSection(page, "페이지 이동");
  const tools = page.getByRole("complementary", { name: "책 도구" });
  const target = preset === "50%" ? 500 : 750;
  await tools.getByRole("slider", { name: "읽기 위치" }).fill(String(target));
  const progress = page.getByRole("slider", { name: "읽기 진행률" });
  await expect
    .poll(async () => Math.abs(Number(await progress.inputValue()) - target))
    .toBeLessThanOrEqual(50);
  await settleReaderLayout(page);
}

async function switchReadingFlow(
  page: Page,
  flow: "가로 페이지" | "세로 스크롤",
) {
  await selectDesktopSection(page, "읽기 설정");
  const tools = page.getByRole("complementary", { name: "책 도구" });
  await tools.getByRole("button", { name: flow, exact: true }).click();
  await expect(page.locator(".reader-viewport")).toHaveClass(
    flow === "가로 페이지" ? /is-paged/u : /is-scrolling/u,
  );
  await settleReaderLayout(page);
}

test.describe("desktop reader acceptance", () => {
  test.beforeEach(({ page }, testInfo) => {
    void page;
    test.skip(
      testInfo.project.name !== "desktop-1280",
      "High-cost reader contracts run at the desktop approval viewport.",
    );
  });

  test.beforeEach(async ({ page }) => {
    await openReader(page);
  });

  test("keeps the first visible paragraph within one paragraph across reading flows", async ({
    page,
  }) => {
    const generated = buildGeneratedBook(360, "mixed");
    await importGeneratedBook(page, "acceptance-location.txt", generated);
    await jumpToPreset(page, "50%");

    const horizontalBefore = await expectVisibleLocator(page);
    const expectedParagraph = paragraphIndexForOffset(
      generated.paragraphOffsets,
      horizontalBefore.characterOffset,
    );

    await switchReadingFlow(page, "세로 스크롤");
    const vertical = await expectVisibleLocator(page);
    const verticalParagraph = paragraphIndexForOffset(
      generated.paragraphOffsets,
      vertical.characterOffset,
    );
    expect(
      Math.abs(verticalParagraph - expectedParagraph),
      `horizontal paragraph ${expectedParagraph}, vertical paragraph ${verticalParagraph}`,
    ).toBeLessThanOrEqual(1);

    await switchReadingFlow(page, "가로 페이지");
    const horizontalAfter = await expectVisibleLocator(page);
    const restoredParagraph = paragraphIndexForOffset(
      generated.paragraphOffsets,
      horizontalAfter.characterOffset,
    );
    expect(
      Math.abs(restoredParagraph - expectedParagraph),
      `initial horizontal paragraph ${expectedParagraph}, restored horizontal paragraph ${restoredParagraph}`,
    ).toBeLessThanOrEqual(1);
  });

  test("focus mode expands the reading viewport and restores its locator", async ({
    page,
  }) => {
    await jumpToPreset(page, "50%");
    const reader = page.locator(".reader-viewport");
    const initialBox = await reader.boundingBox();
    if (!initialBox) throw new Error("The initial reader viewport has no bounds.");
    const initialLocator = await expectVisibleLocator(page);

    const trigger = page.getByRole("button", { name: "더보기", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "읽기 도구" });
    await dialog.getByRole("button", { name: /집중 모드/u }).click();
    await expect(page.locator(".app-shell")).toHaveClass(/is-focus-mode/u);
    await settleReaderLayout(page);

    const focusedBox = await reader.boundingBox();
    if (!focusedBox) throw new Error("The focused reader viewport has no bounds.");
    expect(focusedBox.width).toBeGreaterThan(initialBox.width);
    expect(focusedBox.height).toBeGreaterThan(initialBox.height);

    await page.keyboard.press("Control+Shift+F");
    await expect(page.locator(".app-shell")).not.toHaveClass(/is-focus-mode/u);
    await settleReaderLayout(page);

    const recoveredBox = await reader.boundingBox();
    if (!recoveredBox) {
      throw new Error("The recovered reader viewport has no bounds.");
    }
    expect(Math.abs(recoveredBox.width - initialBox.width)).toBeLessThanOrEqual(
      2,
    );
    expect(
      Math.abs(recoveredBox.height - initialBox.height),
    ).toBeLessThanOrEqual(2);
    const recoveredLocator = await expectVisibleLocator(page);
    expect(
      Math.abs(recoveredLocator.paragraph - initialLocator.paragraph),
      `initial focus paragraph ${initialLocator.paragraph}, recovered paragraph ${recoveredLocator.paragraph}`,
    ).toBeLessThanOrEqual(1);
  });

  test("bounds mounted paragraph nodes for a large vertically-scrolled book", async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const generated = buildGeneratedBook(3_000, "uniform");
    await importGeneratedBook(page, "acceptance-virtual-window.txt", generated);
    await switchReadingFlow(page, "세로 스크롤");

    const mountedParagraphs = page.locator(
      ".reader-viewport [data-paragraph]",
    );
    await expect.poll(() => mountedParagraphs.count()).toBeGreaterThan(0);
    await expect
      .poll(() => mountedParagraphs.count())
      .toBeLessThanOrEqual(MAX_MOUNTED_PARAGRAPHS);

    await jumpToPreset(page, "75%");
    const farLocator = await expectVisibleLocator(page);
    expect(
      paragraphIndexForOffset(
        generated.paragraphOffsets,
        farLocator.characterOffset,
      ),
    ).toBeGreaterThan(2_000);
    await expect
      .poll(() => mountedParagraphs.count())
      .toBeLessThanOrEqual(MAX_MOUNTED_PARAGRAPHS);
  });

  test("moves initial focus into adaptive dialogs and restores the trigger on Escape", async ({
    page,
  }) => {
    const trigger = page.getByRole("button", { name: "검색", exact: true });
    await trigger.focus();
    await expect(trigger).toBeFocused();
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: "읽기 도구" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByPlaceholder("단어나 문장 검색")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});
