from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urljoin, urlparse
from pathlib import Path
import shutil
import tempfile
import time
from typing import Any

from selenium import webdriver
from selenium.common.exceptions import TimeoutException, WebDriverException
from selenium.webdriver.chrome.service import Service as ChromeService
from selenium.webdriver.common.selenium_manager import SeleniumManager
from selenium.webdriver import ChromeOptions, FirefoxOptions
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.remote.webdriver import WebDriver, WebElement
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

from cua_lark.config import BrowserConfig


@dataclass
class BrowserElementSpec:
    selector_type: str
    selector: str


class BrowserSession:
    def __init__(self, config: BrowserConfig) -> None:
        self.config = config
        self._driver: WebDriver | None = None
        self._temp_user_data_dir: Path | None = None

    @property
    def driver(self) -> WebDriver:
        if self._driver is None:
            self._driver, self._temp_user_data_dir = _build_driver(self.config)
            self._driver.implicitly_wait(self.config.implicit_wait_seconds)
            self._driver.set_page_load_timeout(self.config.page_load_timeout_seconds)
        return self._driver

    def ensure_url(
        self,
        url: str | None = None,
        *,
        manual_login_wait_seconds: float = 0.0,
        force_navigation: bool = False,
    ) -> None:
        target = url or self.config.start_url
        if not target:
            return
        current = ""
        try:
            current = self.driver.current_url
        except Exception:
            current = ""
        if force_navigation or self._should_navigate(current, target):
            try:
                self.driver.get(target)
            except TimeoutException:
                current_after_timeout = ""
                try:
                    current_after_timeout = self.driver.current_url
                except Exception:
                    current_after_timeout = ""
                if not self._is_same_feishu_host(current_after_timeout, target):
                    raise
            except WebDriverException:
                current_after_error = ""
                try:
                    current_after_error = self.driver.current_url
                except Exception:
                    current_after_error = ""
                if not self._is_same_feishu_host(current_after_error, target):
                    raise
        if self._is_feishu_login_page():
            if manual_login_wait_seconds > 0:
                deadline = time.time() + manual_login_wait_seconds
                while time.time() < deadline:
                    time.sleep(1.0)
                    if not self._is_feishu_login_page():
                        return
            raise RuntimeError(
                "Feishu Web login is required for the browser backup chain. "
                "The cloned browser profile did not carry a usable web login session."
            )

    def _should_navigate(self, current: str, target: str) -> bool:
        if not current:
            return True
        if current.startswith(target):
            return False
        if self._is_same_feishu_host(current, target) and not self._is_feishu_login_url(current):
            return False
        return True

    def _is_same_feishu_host(self, current: str, target: str) -> bool:
        try:
            current_host = urlparse(current).netloc
            target_host = urlparse(target).netloc
        except Exception:
            return False
        return bool(current_host and target_host and current_host == target_host)

    def _is_feishu_login_url(self, url: str) -> bool:
        return "accounts.feishu.cn/accounts/page/login" in url

    def open_candidate_urls(
        self,
        candidate_urls: list[str],
        *,
        expected_url_contains: list[str] | None = None,
        expected_page_contains: list[str] | None = None,
        manual_login_wait_seconds: float = 0.0,
    ) -> str:
        if not candidate_urls:
            raise RuntimeError("browser candidate_urls is empty")

        last_url = ""
        for raw_url in candidate_urls:
            target = self._resolve_candidate_url(raw_url)
            self.ensure_url(
                target,
                manual_login_wait_seconds=manual_login_wait_seconds,
                force_navigation=True,
            )
            last_url = self.driver.current_url
            if self._matches_browser_expectations(
                expected_url_contains=expected_url_contains,
                expected_page_contains=expected_page_contains,
            ):
                return last_url

        raise RuntimeError(
            "browser candidate_urls did not reach the expected page. "
            f"last_url={last_url}"
        )

    def _resolve_candidate_url(self, raw_url: str) -> str:
        raw = raw_url.strip()
        if raw.startswith("http://") or raw.startswith("https://"):
            return raw

        config_base = self.config.start_url or ""
        if config_base:
            parsed = urlparse(config_base)
            if parsed.scheme and parsed.netloc:
                return urljoin(f"{parsed.scheme}://{parsed.netloc}/", raw.lstrip("/"))

        current_url = ""
        try:
            current_url = self.driver.current_url
        except Exception:
            current_url = ""
        base = current_url or self.config.start_url or ""
        if not base:
            raise RuntimeError("browser route resolution requires a current_url or start_url")
        parsed = urlparse(base)
        base_origin = f"{parsed.scheme}://{parsed.netloc}"
        return urljoin(f"{base_origin}/", raw.lstrip("/"))

    def _matches_browser_expectations(
        self,
        *,
        expected_url_contains: list[str] | None = None,
        expected_page_contains: list[str] | None = None,
    ) -> bool:
        if not expected_url_contains and not expected_page_contains:
            return True

        current_url = self.driver.current_url
        if expected_url_contains:
            if any(token and token in current_url for token in expected_url_contains):
                return True

        page_source = self.driver.page_source
        if expected_page_contains:
            if any(token and token in page_source for token in expected_page_contains):
                return True

        return False

    def _is_feishu_login_page(self) -> bool:
        try:
            current_url = self.driver.current_url
        except Exception:
            return False
        return self._is_feishu_login_url(current_url)

    def find_element(self, metadata: dict[str, Any], *, wait_seconds: float | None = None) -> WebElement:
        spec = _resolve_selector_spec(metadata)
        by = _to_by(spec.selector_type)
        wait = WebDriverWait(self.driver, wait_seconds or self.config.implicit_wait_seconds)
        return wait.until(EC.presence_of_element_located((by, spec.selector)))

    def find_clickable(self, metadata: dict[str, Any], *, wait_seconds: float | None = None) -> WebElement:
        spec = _resolve_selector_spec(metadata)
        by = _to_by(spec.selector_type)
        wait = WebDriverWait(self.driver, wait_seconds or self.config.implicit_wait_seconds)
        return wait.until(EC.element_to_be_clickable((by, spec.selector)))

    def click(self, metadata: dict[str, Any]) -> str:
        element = self.find_clickable(metadata)
        label = element.text.strip() or element.get_attribute("aria-label") or element.tag_name
        element.click()
        return label

    def click_point(self, metadata: dict[str, Any]) -> str:
        x, y = _resolve_viewport_point(self.driver, metadata)
        payload = self.driver.execute_script(
            """
const x = arguments[0];
const y = arguments[1];
const el = document.elementFromPoint(x, y);
if (!el) {
  return { ok: false };
}
el.click();
return {
  ok: true,
  tag: el.tagName || '',
  text: (el.innerText || el.textContent || '').trim().slice(0, 120),
  aria: el.getAttribute ? (el.getAttribute('aria-label') || '') : ''
};
""",
            x,
            y,
        )
        if not isinstance(payload, dict) or not payload.get("ok"):
            raise RuntimeError(f"browser point click failed at ({x:.1f}, {y:.1f})")
        label = (
            str(payload.get("text") or "").strip()
            or str(payload.get("aria") or "").strip()
            or str(payload.get("tag") or "").strip()
            or "point-target"
        )
        return f"{label} @ ({x:.1f}, {y:.1f})"

    def type(self, metadata: dict[str, Any], value: str) -> str:
        element = self.find_element(metadata)
        if bool(metadata.get("click_before_type", True)):
            try:
                element.click()
            except Exception:
                pass
        if bool(metadata.get("clear_first", True)):
            element.clear()
        element.send_keys(value)
        return value

    def type_via_active_element(self, metadata: dict[str, Any], value: str) -> str:
        if any(key in metadata for key in ("x", "y", "x_ratio", "y_ratio")):
            self.click_point(metadata)
        active = self.driver.switch_to.active_element
        if bool(metadata.get("clear_first", True)):
            try:
                active.clear()
            except Exception:
                pass
        active.send_keys(value)
        return value

    def send_hotkey(self, hotkey: str, metadata: dict[str, Any]) -> str:
        chord = _parse_hotkey(hotkey)
        target: WebElement | None = None
        if metadata.get("selector") or metadata.get("selectors"):
            target = self.find_element(metadata)
        actions = ActionChains(self.driver)
        if target is not None:
            actions.move_to_element(target).click()
        actions.key_down(chord[0])
        for key in chord[1:-1]:
            actions.send_keys(key)
        actions.send_keys(chord[-1])
        actions.key_up(chord[0])
        actions.perform()
        return hotkey

    def wait_for_text(self, text: str, timeout_seconds: float) -> bool:
        try:
            WebDriverWait(self.driver, timeout_seconds).until(
                lambda d: text in d.page_source or text in d.title
            )
            return True
        except TimeoutException:
            return False

    def screenshot(self, path: Path) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.driver.save_screenshot(str(path))
        return path

    def current_metadata(self) -> dict[str, Any]:
        title = ""
        url = ""
        page_source = ""
        try:
            title = self.driver.title
        except Exception:
            title = ""
        try:
            url = self.driver.current_url
        except Exception:
            url = ""
        try:
            page_source = self.driver.page_source
        except Exception:
            page_source = ""
        return {
            "browser_title": title,
            "browser_url": url,
            "browser_page_contains_create_event": "创建日程" in page_source,
            "browser_page_contains_messages": "消息" in page_source,
            "browser_login_required": "accounts.feishu.cn/accounts/page/login" in url,
        }

    def close(self) -> None:
        if self._driver is not None:
            self._driver.quit()
            self._driver = None
        if self._temp_user_data_dir is not None:
            shutil.rmtree(self._temp_user_data_dir, ignore_errors=True)
            self._temp_user_data_dir = None


_SESSION: BrowserSession | None = None


def get_browser_session(config: BrowserConfig) -> BrowserSession:
    global _SESSION
    if _SESSION is None:
        _SESSION = BrowserSession(config)
    return _SESSION


def _build_driver(config: BrowserConfig) -> tuple[WebDriver, Path | None]:
    browser_name = config.browser_name.strip().lower()
    if browser_name == "firefox":
        firefox_options = FirefoxOptions()
        if config.headless:
            firefox_options.add_argument("-headless")
        return webdriver.Firefox(options=firefox_options), None

    options = ChromeOptions()
    if config.headless:
        options.add_argument("--headless=new")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--no-sandbox")
    options.add_argument("--no-first-run")
    options.add_argument("--no-default-browser-check")
    options.add_argument("--disable-background-networking")
    temp_user_data_dir: Path | None = None
    effective_user_data_dir: Path | None = None
    effective_profile_directory = config.profile_directory

    if config.persistent_user_data_dir:
        persistent_dir = Path(config.persistent_user_data_dir).expanduser()
        bootstrap_dir = (
            Path(config.bootstrap_user_data_dir).expanduser()
            if config.bootstrap_user_data_dir
            else (
                Path(config.user_data_dir).expanduser()
                if config.user_data_dir
                else None
            )
        )
        bootstrap_profile = (
            config.bootstrap_profile_directory
            or config.profile_directory
            or "Default"
        )
        effective_user_data_dir = _ensure_persistent_chromium_user_data_dir(
            persistent_dir,
            bootstrap_dir,
            bootstrap_profile,
        )
        effective_profile_directory = bootstrap_profile
    elif config.user_data_dir:
        effective_user_data_dir = Path(config.user_data_dir).expanduser()
        if config.clone_user_data_dir:
            effective_user_data_dir = _clone_chromium_user_data_dir(
                effective_user_data_dir,
                config.profile_directory,
            )
            temp_user_data_dir = effective_user_data_dir

    if effective_user_data_dir is not None:
        options.add_argument(f"--user-data-dir={effective_user_data_dir}")
    if effective_profile_directory:
        options.add_argument(f"--profile-directory={effective_profile_directory}")
    binary_candidates: list[str | None] = []
    if config.binary_location:
        binary_candidates.append(str(Path(config.binary_location).expanduser()))
    binary_candidates.append(None)

    last_error: Exception | None = None
    resolved = SeleniumManager().binary_paths(["--browser", "chrome"])
    driver_path = resolved.get("driver_path") or None

    for binary in binary_candidates:
        trial_options = ChromeOptions()
        for argument in options.arguments:
            trial_options.add_argument(argument)
        if binary:
            trial_options.binary_location = binary
        try:
            service = ChromeService(executable_path=driver_path) if driver_path else ChromeService()
            driver = webdriver.Chrome(service=service, options=trial_options)
            return driver, temp_user_data_dir
        except Exception as exc:
            last_error = exc

    raise RuntimeError(f"failed to launch browser session: {last_error}") from last_error


def _ensure_persistent_chromium_user_data_dir(
    persistent_dir: Path,
    bootstrap_dir: Path | None,
    bootstrap_profile_directory: str,
) -> Path:
    persistent_dir.mkdir(parents=True, exist_ok=True)

    persistent_profile_dir = persistent_dir / bootstrap_profile_directory
    has_persistent_profile = (
        persistent_profile_dir.exists()
        and (persistent_profile_dir / "Preferences").exists()
    )
    if has_persistent_profile:
        _clear_chromium_runtime_locks(persistent_dir)
        return persistent_dir

    if bootstrap_dir is None:
        return persistent_dir

    temp_clone = _clone_chromium_user_data_dir(bootstrap_dir, bootstrap_profile_directory)
    try:
        for child in temp_clone.iterdir():
            target = persistent_dir / child.name
            if child.is_dir():
                shutil.copytree(child, target, dirs_exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(child, target)
    finally:
        shutil.rmtree(temp_clone, ignore_errors=True)

    _clear_chromium_runtime_locks(persistent_dir)
    return persistent_dir


def _clear_chromium_runtime_locks(user_data_dir: Path) -> None:
    for pattern in ("Singleton*",):
        for path in user_data_dir.glob(pattern):
            _remove_path(path)

    for relative_name in ("User Data/DevToolsActivePort", f"Default/LOCK"):
        path = user_data_dir / relative_name
        if path.exists():
            _remove_path(path)


def _remove_path(path: Path) -> None:
    try:
        if path.is_dir() and not path.is_symlink():
            shutil.rmtree(path, ignore_errors=True)
        else:
            path.unlink(missing_ok=True)
    except Exception:
        pass


def _clone_chromium_user_data_dir(source_dir: Path, profile_directory: str | None) -> Path:
    if not source_dir.exists():
        raise RuntimeError(f"browser user data dir not found: {source_dir}")

    temp_root = Path(tempfile.mkdtemp(prefix="cua-lark-browser-", dir="/private/tmp"))

    for root_file in ["Local State", "First Run", "Last Version"]:
        source_file = source_dir / root_file
        if source_file.exists() and source_file.is_file():
            shutil.copy2(source_file, temp_root / root_file)

    profile_name = profile_directory or "Default"
    source_profile_dir = source_dir / profile_name
    if not source_profile_dir.exists():
        raise RuntimeError(f"browser profile dir not found: {source_profile_dir}")

    target_profile_dir = temp_root / profile_name
    target_profile_dir.mkdir(parents=True, exist_ok=True)

    essential_files = [
        "Preferences",
        "Secure Preferences",
        "Cookies",
        "Cookies-journal",
        "Network Persistent State",
    ]
    essential_dirs = [
        "Local Storage",
        "Session Storage",
    ]

    for relative_name in essential_files:
        source_path = source_profile_dir / relative_name
        target_path = target_profile_dir / relative_name
        if source_path.exists() and source_path.is_file():
            target_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_path, target_path)

    for relative_name in essential_dirs:
        source_path = source_profile_dir / relative_name
        target_path = target_profile_dir / relative_name
        if source_path.exists() and source_path.is_dir():
            shutil.copytree(
                source_path,
                target_path,
                ignore=shutil.ignore_patterns(
                    "Cache",
                    "CacheStorage",
                    "Code Cache",
                    "GPUCache",
                    "GrShaderCache",
                    "DawnWebGPUCache",
                    "Singleton*",
                    "LOCK",
                    "lockfile",
                    "DevToolsActivePort",
                ),
                dirs_exist_ok=True,
            )

    indexeddb_source = source_profile_dir / "IndexedDB"
    indexeddb_target = target_profile_dir / "IndexedDB"
    if indexeddb_source.exists() and indexeddb_source.is_dir():
        indexeddb_target.mkdir(parents=True, exist_ok=True)
        for child in indexeddb_source.iterdir():
            lowered_name = child.name.lower()
            if not any(
                token in lowered_name
                for token in ("feishu", "larkoffice", "accounts.feishu.cn")
            ):
                continue
            target_child = indexeddb_target / child.name
            if child.is_dir():
                shutil.copytree(
                    child,
                    target_child,
                    ignore=shutil.ignore_patterns(
                        "LOCK",
                        "LOCK-journal",
                        "Singleton*",
                    ),
                    dirs_exist_ok=True,
                )
            elif child.is_file():
                target_child.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(child, target_child)

    return temp_root


def _resolve_selector_spec(metadata: dict[str, Any]) -> BrowserElementSpec:
    raw_selectors = metadata.get("selectors")
    if isinstance(raw_selectors, list):
        for item in raw_selectors:
            if not isinstance(item, dict):
                continue
            selector = str(item.get("selector") or "").strip()
            selector_type = str(item.get("type") or item.get("selector_type") or "css").strip().lower()
            if selector:
                return BrowserElementSpec(selector_type=selector_type, selector=selector)

    selector = str(metadata.get("selector") or "").strip()
    selector_type = str(metadata.get("selector_type") or "css").strip().lower()
    if not selector:
        raise ValueError("browser action requires metadata.selector or metadata.selectors")
    return BrowserElementSpec(selector_type=selector_type, selector=selector)


def _to_by(selector_type: str) -> str:
    mapping = {
        "css": By.CSS_SELECTOR,
        "xpath": By.XPATH,
        "id": By.ID,
        "name": By.NAME,
    }
    if selector_type not in mapping:
        raise ValueError(f"unsupported browser selector_type: {selector_type}")
    return mapping[selector_type]


def _parse_hotkey(hotkey: str) -> tuple[str, ...]:
    tokens = [token.strip().lower() for token in hotkey.split("+") if token.strip()]
    if not tokens:
        raise ValueError("empty browser hotkey")
    key_map = {
        "cmd": Keys.COMMAND,
        "command": Keys.COMMAND,
        "ctrl": Keys.CONTROL,
        "control": Keys.CONTROL,
        "shift": Keys.SHIFT,
        "alt": Keys.ALT,
        "option": Keys.ALT,
        "return": Keys.RETURN,
        "enter": Keys.ENTER,
        "escape": Keys.ESCAPE,
        "esc": Keys.ESCAPE,
        "tab": Keys.TAB,
        "space": Keys.SPACE,
    }
    resolved: list[str] = []
    for token in tokens:
        resolved.append(key_map.get(token, token))
    return tuple(resolved)


def _resolve_viewport_point(driver: WebDriver, metadata: dict[str, Any]) -> tuple[float, float]:
    if "x" in metadata and "y" in metadata:
        return float(metadata["x"]), float(metadata["y"])

    width = float(driver.execute_script("return window.innerWidth"))
    height = float(driver.execute_script("return window.innerHeight"))
    if "x_ratio" not in metadata or "y_ratio" not in metadata:
        raise RuntimeError("browser point click requires x/y or x_ratio/y_ratio")
    return width * float(metadata["x_ratio"]), height * float(metadata["y_ratio"])
