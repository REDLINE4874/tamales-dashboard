let customSelectCounter = 0;

function enhanceCustomSelect(select) {
  if (select.customSelect) {
    refreshCustomSelect(select);
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "custom-select";
  if (select.classList.contains("chart-month-select")) {
    wrapper.classList.add("chart-month-select");
  }
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "custom-select-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  const label = [...document.querySelectorAll("label[for]")].find(
    (item) => item.htmlFor === select.id,
  );
  trigger.setAttribute(
    "aria-label",
    select.getAttribute("aria-label") || label?.textContent.trim() || "Seleccionar opción",
  );

  const listbox = document.createElement("div");
  listbox.className = "custom-select-listbox";
  listbox.id = `custom-select-listbox-${++customSelectCounter}`;
  listbox.setAttribute("role", "listbox");
  listbox.hidden = true;
  trigger.setAttribute("aria-controls", listbox.id);

  select.parentNode.insertBefore(wrapper, select);
  wrapper.append(select, trigger, listbox);
  select.classList.add("custom-select-native");
  select.tabIndex = -1;
  select.hidden = true;
  select.setAttribute("aria-hidden", "true");
  select.customSelect = { wrapper, trigger, listbox };

  trigger.addEventListener("click", () => {
    if (trigger.getAttribute("aria-expanded") === "true") closeCustomSelect(select);
    else openCustomSelect(select);
  });
  trigger.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === " ") {
      event.preventDefault();
      openCustomSelect(select);
    }
  });
  listbox.addEventListener("keydown", (event) => {
    const options = [...listbox.querySelectorAll('[role="option"]:not(:disabled)')];
    const currentIndex = options.indexOf(document.activeElement);
    let nextIndex = currentIndex;

    if (event.key === "ArrowDown") nextIndex = Math.min(currentIndex + 1, options.length - 1);
    else if (event.key === "ArrowUp") nextIndex = Math.max(currentIndex - 1, 0);
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = options.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      closeCustomSelect(select, true);
      return;
    } else if (event.key === "Tab") {
      closeCustomSelect(select);
      return;
    } else {
      return;
    }

    event.preventDefault();
    options[nextIndex]?.focus();
  });
  listbox.addEventListener("click", (event) => {
    const option = event.target.closest('[role="option"]');
    if (!option || option.disabled) return;
    select.value = option.dataset.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    refreshCustomSelect(select);
    closeCustomSelect(select, true);
  });
  select.addEventListener("change", () => refreshCustomSelect(select));

  document.querySelectorAll(`label[for="${CSS.escape(select.id)}"]`).forEach((label) => {
    label.addEventListener("click", (event) => {
      event.preventDefault();
      trigger.focus();
      openCustomSelect(select);
    });
  });

  refreshCustomSelect(select);
}

function refreshCustomSelect(select) {
  const custom = select.customSelect;
  if (!custom) return;

  const selectedOption = select.options[select.selectedIndex];
  custom.trigger.textContent = selectedOption ? selectedOption.textContent : "Selecciona…";
  custom.trigger.disabled = select.disabled || select.options.length === 0;

  const listbox = custom.listbox;
  listbox.replaceChildren();
  [...select.options].forEach((option, index) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "custom-select-option";
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", option.selected ? "true" : "false");
    item.textContent = option.textContent;
    item.dataset.value = option.value;
    item.disabled = option.disabled;
    item.tabIndex = -1;
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        item.click();
      }
    });
    listbox.appendChild(item);
  });
}

function openCustomSelect(select) {
  const custom = select.customSelect;
  if (!custom || custom.trigger.disabled) return;
  document.querySelectorAll(".custom-select[aria-expanded='true']").forEach((wrapper) => {
    if (wrapper !== custom.wrapper) {
      const otherSelect = wrapper.querySelector(".custom-select-native");
      if (otherSelect) closeCustomSelect(otherSelect);
    }
  });

  custom.wrapper.setAttribute("aria-expanded", "true");
  custom.trigger.setAttribute("aria-expanded", "true");
  custom.listbox.hidden = false;
  const selected = custom.listbox.querySelector('[aria-selected="true"]:not(:disabled)');
  (selected || custom.listbox.querySelector('[role="option"]:not(:disabled)'))?.focus();
}

function closeCustomSelect(select, focusTrigger = false) {
  const custom = select.customSelect;
  if (!custom) return;
  custom.wrapper.setAttribute("aria-expanded", "false");
  custom.trigger.setAttribute("aria-expanded", "false");
  custom.listbox.hidden = true;
  if (focusTrigger) custom.trigger.focus();
}

document.addEventListener("click", (event) => {
  if (event.target.closest(".custom-select")) return;
  document.querySelectorAll(".custom-select[aria-expanded='true'] .custom-select-native")
    .forEach((select) => closeCustomSelect(select));
});

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("select").forEach(enhanceCustomSelect);
});
