// DOM Utilities
// Helper functions for DOM traversal and analysis

/**
 * Get a unique CSS selector path for an element
 */
export function getElementPath(element: Element): string {
    const path: string[] = [];
    let current: Element | null = element;

    while (current && current !== document.body) {
        let selector = current.tagName.toLowerCase();

        if (current.id) {
            selector = `#${CSS.escape(current.id)}`;
            path.unshift(selector);
            break; // ID is unique, no need to go further
        }

        // Add class names (first class only to avoid overly specific selectors)
        if (current.className && typeof current.className === 'string') {
            const firstClass = current.className.split(' ')[0];
            if (firstClass) {
                selector += `.${CSS.escape(firstClass)}`;
            }
        }

        // Add nth-child if there are siblings of the same type
        const parent = current.parentElement;
        if (parent) {
            const siblings = Array.from(parent.children).filter(
                (child) => child.tagName === current!.tagName
            );
            if (siblings.length > 1) {
                const index = siblings.indexOf(current) + 1;
                selector += `:nth-of-type(${index})`;
            }
        }

        path.unshift(selector);
        current = current.parentElement;
    }

    return path.join(' > ');
}

/**
 * Get associated label text for an input element
 */
export function getLabelText(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string | undefined {
    // Method 1: Explicit label association via 'for' attribute
    if (element.id) {
        const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
        if (label?.textContent) {
            return cleanText(label.textContent);
        }
    }

    // Method 2: Label as parent/ancestor
    const parentLabel = element.closest('label');
    if (parentLabel?.textContent) {
        // Remove the input's own text content from the label
        const clone = parentLabel.cloneNode(true) as HTMLElement;
        const inputs = clone.querySelectorAll('input, select, textarea');
        inputs.forEach((input) => input.remove());
        if (clone.textContent) {
            return cleanText(clone.textContent);
        }
    }

    // Method 3: ARIA label
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) {
        return cleanText(ariaLabel);
    }

    // Method 4: ARIA labelledby
    const ariaLabelledBy = element.getAttribute('aria-labelledby');
    if (ariaLabelledBy) {
        const labelElement = document.getElementById(ariaLabelledBy);
        if (labelElement?.textContent) {
            return cleanText(labelElement.textContent);
        }
    }

    return undefined;
}

/**
 * Get text from sibling elements (often descriptive text)
 */
export function getSiblingText(element: Element): string | undefined {
    const siblings: string[] = [];

    // Check previous siblings
    let prev = element.previousElementSibling;
    if (prev && isTextElement(prev)) {
        const text = cleanText(prev.textContent || '');
        if (text.length < 100) { // Avoid capturing large blocks
            siblings.push(text);
        }
    }

    // Check next siblings
    let next = element.nextElementSibling;
    if (next && isTextElement(next)) {
        const text = cleanText(next.textContent || '');
        if (text.length < 100) {
            siblings.push(text);
        }
    }

    return siblings.length > 0 ? siblings.join(' ') : undefined;
}

/**
 * Get text from parent element (excluding child inputs)
 */
export function getParentText(element: Element): string | undefined {
    const parent = element.parentElement;
    if (!parent) return undefined;

    const clone = parent.cloneNode(true) as HTMLElement;
    const inputs = clone.querySelectorAll('input, select, textarea, button');
    inputs.forEach((input) => input.remove());

    const text = cleanText(clone.textContent || '');
    return text.length > 0 && text.length < 200 ? text : undefined;
}

/**
 * Get element position on page
 */
export function getElementPosition(element: Element): { x: number; y: number } {
    const rect = element.getBoundingClientRect();
    return {
        x: rect.left + window.scrollX,
        y: rect.top + window.scrollY,
    };
}

/**
 * Check if element is visible
 */
export function isElementVisible(element: Element): boolean {
    const style = window.getComputedStyle(element);

    if (style.display === 'none') return false;
    if (style.visibility === 'hidden') return false;
    if (style.opacity === '0') return false;

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;

    return true;
}

/**
 * Check if element is a simple text element
 */
function isTextElement(element: Element): boolean {
    const textTags = ['SPAN', 'P', 'DIV', 'LABEL', 'SMALL', 'STRONG', 'EM', 'B', 'I'];
    return textTags.includes(element.tagName);
}

/**
 * Clean and normalize text content
 */
function cleanText(text: string): string {
    return text
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Query elements including shadow DOM
 */
export function querySelectorAllDeep(
    selector: string,
    root: Document | Element = document
): Element[] {
    const results: Element[] = [];

    // Query current level
    results.push(...Array.from(root.querySelectorAll(selector)));

    // Query shadow roots
    const allElements = root.querySelectorAll('*');
    allElements.forEach((element) => {
        if (element.shadowRoot) {
            results.push(...querySelectorAllDeep(selector, element.shadowRoot as unknown as Element));
        }
    });

    return results;
}
