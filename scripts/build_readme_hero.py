from __future__ import annotations

import base64
import io
import math
import random
from dataclasses import dataclass
from operator import itemgetter
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageOps

REPO_ROOT = Path(__file__).resolve().parent.parent
SAMPLES_OUT_DIR = REPO_ROOT / "samples" / "out"
OUTPUT_PATH = REPO_ROOT / "docs" / "images" / "readme-hero.svg"

MAT = "#2B5A4A"
MAT_DEEP = "#173A30"
MAT_LINE = "#8DB8A6"
PAPER = "#F7F5EF"
CHALK_SOFT = "#A9C7BA"
MARKER = "#D9372B"
STEEL = "#C9CCC8"
SCAN_LIGHT = "#FFF6D8"
SHADOW = "#0B2019"
WHITE = "#FFFFFF"
BLACK = "#000000"
SHADOW_REST_ALPHA = 0.45
FONT_SANS = (
    "'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP',system-ui,sans-serif"
)
TITLE = "Kururi AI turns sideways and upside-down photos upright"
DESCRIPTION = (
    "Sideways and upside-down photo prints on a green cutting mat get a red 天 mark "
    "on their true top, turn in quarter steps until upright, and land one by one in "
    "a tidy grid"
)

WIDTH = 1280
HEIGHT = 620
FRAME_RADIUS = 26
FRONT_FACE = 12
FRAME_MARGIN = 4.0

CAMERA_PITCH_DEG = 44.0
CAMERA_DISTANCE = 18.0
CAMERA_TARGET = (2.5, -1.5)
FRAMING_Z = -1.5
MAT_NEAR_Z = 0.44
OPEN_VIEW = (-2.55, 2.85)
HOLD_VIEW = (-0.5, 5.5)
STILL_VIEW = (-1.12, 4.42)
SCATTER_VIEW = (-1.6, 4.4)
CAMERA_WAYPOINTS = (
    ("lift", 0, 0.0, -2.55, 2.85),
    ("lift", 2, 0.0, -2.33, 3.3),
    ("land", 1, -0.4, -2.38, 4.0),
    ("lift", 5, 0.0, -1.34, 4.5),
    ("lift", 8, 0.22, -0.85, 4.95),
    ("land", 9, -0.4, -0.66, 5.32),
    ("hold", 0, 0.35, -0.5, 5.5),
)
SLOT_LEAD = 0.4
PILE_TAIL = 0.22
CAMERA_SAMPLE_STEP = 0.36

UNIT = 100.0
PRINT_LONG = 92.0
BORDER_FRAC = 0.06
PHOTO_PX = 190
JPEG_QUALITY = 66

MOSAIC_ORIGIN = (0.0, -3.0)
SPIRAL = (
    (2, 1),
    (3, 1),
    (3, 2),
    (2, 2),
    (1, 2),
    (1, 1),
    (1, 0),
    (2, 0),
    (3, 0),
    (4, 0),
    (4, 1),
    (4, 2),
    (0, 2),
    (0, 1),
    (0, 0),
)
SAMPLE_FILES = {
    "sample1": "sample1.webp",
    "sample2": "sample2.webp",
    "sample3": "sample3.webp",
    "sample4": "sample4.webp",
    "sample5": "sample5.jpg",
}
REAL_CORRECTIONS = {
    "sample1": 3,
    "sample2": 3,
    "sample3": 1,
    "sample4": 3,
    "sample5": 2,
}
CROP_ASPECT = 10 / 7
CROP_BOXES = {
    "crop00": ("sample1", 0.015, 0.0, 0.965),
    "crop02": ("sample2", 0.1, 0.4133, 0.8),
    "crop03": ("sample2", 0.07, 0.0, 0.86),
    "crop04": ("sample3", 0.0222, 0.0, 0.9556),
    "crop05": ("sample3", 0.0222, 0.5, 0.9556),
    "crop06": ("sample4", 0.0, 0.0167, 1.0),
    "crop07": ("sample4", 0.1, 0.5133, 0.8),
    "crop08": ("sample5", 0.1511, 0.29, 0.8),
    "crop09": ("sample5", 0.0, 0.04, 0.7022),
    "crop11": ("sample3", 0.0978, 0.29, 0.8),
}
CROP_CORRECTIONS = {
    "crop00": 2,
    "crop02": 1,
    "crop03": 3,
    "crop04": 2,
    "crop05": 1,
    "crop06": 3,
    "crop07": 1,
    "crop08": 2,
    "crop09": 3,
    "crop11": 1,
}
PHOTO_ORDER = (
    "sample5",
    "crop08",
    "sample3",
    "crop02",
    "sample1",
    "crop06",
    "crop04",
    "crop07",
    "crop09",
    "sample2",
    "crop05",
    "crop00",
    "crop03",
    "crop11",
    "sample4",
)
PILE_SPOTS = (
    (-1.43, -1.42, 11.0),
    (-1.53, -2.16, -14.0),
    (-1.48, -0.5, 16.0),
    (-0.86, -0.62, -9.0),
    (-0.93, -1.48, 19.0),
    (-0.81, -2.26, -7.0),
    (-0.27, -2.2, 13.0),
    (-0.33, -1.38, -17.0),
    (-0.24, -0.55, 8.0),
    (0.26, -1.92, -12.0),
    (0.24, -1.0, 15.0),
    (0.31, -0.3, -6.0),
    (0.5, -0.55, 9.0),
    (0.47, -1.5, -15.0),
    (0.52, -2.3, 7.0),
)
START_ANGLE = {0: 0.0, 1: -90.0, 2: -180.0, 3: 90.0}

MARK_BOX = 38.5
MARK_STROKE = 7.6
MARK_TILT_DEG = 6.0
MARK_X_JITTER = 0.1
MARK_CENTER_FROM_TOP = 0.36
MARK_VISUAL_CENTER = 0.05
GLYPH_VARIANTS = 4
GLYPH_JITTER = 1.4
TEN_STROKES = (
    ((31.0, 23.0), (43.0, 22.0), (57.0, 21.0), (69.0, 19.5)),
    ((12.0, 46.0), (36.0, 45.0), (63.0, 44.0), (88.0, 42.0)),
    ((50.0, 23.5), (51.0, 42.0), (46.0, 67.0), (14.0, 89.0)),
    ((51.5, 47.5), (58.0, 63.0), (70.0, 79.0), (90.0, 86.0)),
)
SPECKLE_PX = 64
SPECKLE_TILE = 150.0
SPECKLE_DOTS = 170
SPECKLE_LEVELS = (110, 150, 190)

LOUPE_REST = (-4.3, -1.25)
LOUPE_RADIUS = 82.0
LOUPE_RING = 13.0
LOUPE_ZOOM = 1.28
LOUPE_SHADOW_REST = (5.0, 8.0)
LOUPE_SHADOW_HOVER = (19.0, 31.0)
LOUPE_IN_AT = 0.06
LOUPE_MOVE = 0.36
LOUPE_DWELL = 0.28

SCAN_DURATION = 0.42
SCAN_BAND = 0.74
SCAN_LEAD = 0.86
SCAN_LINE = 0.05
SCAN_LINE_OVERHANG = 0.08
MARK_AT = 0.3
STROKE_GAP = 0.07
STROKE_DURATION = 0.1
LIFT_PAUSE = 0.1
FIRST_GAP = 0.5
PICK_INTERVAL = 0.38
FLIGHT = 1.0
FIRST_FLIGHT = 1.18
HOLD = 2.05
SCATTER_STAGGER = 0.04
SCATTER_FLIGHT = 0.82
END_REST = 0.14
SWAP = 0.01
MARK_HIDE_AFTER = 1.3
MARK_FADE = 0.3

LIFT_PX = 54.0
FIRST_LIFT_PX = 72.0
SCATTER_LIFT_PX = 44.0
LIFT_SCALE = 0.075
FIRST_LIFT_SCALE = 0.14
SCATTER_LIFT_SCALE = 0.05
SHADOW_REST_OFFSET = (1.4, 2.4)
SHADOW_LIFT_OFFSET = (9.0, 15.0)
SHADOW_LIFT_GROW = 0.6

EASE_OUT = "cubic-bezier(.22,.8,.32,1)"
EASE_IN = "cubic-bezier(.55,0,.8,.3)"
EASE_IN_OUT = "ease-in-out"
EASE_IN_OUT_CUBIC = "cubic-bezier(.65,0,.35,1)"
EASE_OUT_BACK = "cubic-bezier(.34,1.56,.64,1)"
EASE_OUT_BACK_STRONG = "cubic-bezier(.3,2.05,.5,1)"
EASE_SOFT = "cubic-bezier(.45,0,.3,1)"
EASE_SCAN = "cubic-bezier(.4,0,.6,1)"
EASE_WRITE = "cubic-bezier(.3,.1,.4,1)"

PICK_LIFT = (
    (0.0, 0.0, EASE_OUT),
    (0.28, 1.0, EASE_IN_OUT),
    (0.52, 0.92, EASE_IN),
    (0.86, 0.0, EASE_OUT),
    (0.93, 0.07, EASE_IN),
    (1.0, 0.0, None),
)
FIRST_LIFT = (
    (0.0, 0.0, EASE_OUT),
    (0.3, 1.0, EASE_IN_OUT),
    (0.55, 0.9, EASE_IN),
    (0.86, 0.0, None),
    (1.0, 0.0, None),
)
FIRST_SQUASH = (
    (0.86, 1.0, 1.0, EASE_OUT),
    (0.9, 1.05, 0.93, EASE_IN_OUT),
    (0.95, 0.985, 1.02, EASE_IN_OUT),
    (1.0, 1.0, 1.0, None),
)
SCATTER_LIFT = (
    (0.0, 0.0, EASE_OUT),
    (0.3, 1.0, EASE_IN_OUT),
    (0.62, 0.86, EASE_IN),
    (1.0, 0.0, None),
)
PICK_TRAVEL = (0.08, 0.8, EASE_IN_OUT_CUBIC)
PICK_SPIN = (0.12, 0.86, EASE_OUT_BACK)
FIRST_SPIN = (0.14, 0.84, EASE_OUT_BACK_STRONG)
SCATTER_TRAVEL = (0.06, 0.94, EASE_SOFT)
PICK_CRUISE = (0.1, 0.74)
SCATTER_CRUISE = (0.12, 0.8)
SCATTER_SPIN = (0.05, 0.95, EASE_SOFT)

STILL_PLACED = 7
STILL_TRAVEL = 0.97
STILL_TURN = 0.68
STILL_LIFT = 0.42

RULER_Z = 0.3
RULER_TICKS = (0.06, 0.1, 0.16)
RULER_FONT = 11.0
RULER_NUMERAL_Z = 0.13
RULER_ORIGIN = -4.0
RULER_NUMERAL_HALF = 22.0
MINOR_GRID_FAR_Z = -4.5
MAT_OVERSCAN = 1.4
MAT_OVERSCAN_PX = 330.0

SEED = 7

Matrix = tuple[float, float, float, float, float, float]
Point = tuple[float, float]
Stop = tuple[float, str, str | None]
Profile = tuple[tuple[float, float, str | None], ...]


@dataclass(frozen=True)
class Camera:
    eye_x: float
    eye_y: float
    eye_z: float
    sin_pitch: float
    cos_pitch: float
    focal: float

    def project(self, x: float, z: float) -> Point:
        dx = x - self.eye_x
        dy = -self.eye_y
        dz = z - self.eye_z
        depth = -dy * self.sin_pitch - dz * self.cos_pitch
        up = dy * self.cos_pitch - dz * self.sin_pitch
        return self.focal * dx / depth, -self.focal * up / depth

    def desk_matrix(self, x: float, z: float) -> Matrix:
        step = 1e-4
        x1, y1 = self.project(x + step, z)
        x0, y0 = self.project(x - step, z)
        x3, y3 = self.project(x, z + step)
        x2, y2 = self.project(x, z - step)
        scale = 2 * step * UNIT
        e, f = self.project(x, z)
        return (
            (x1 - x0) / scale,
            (y1 - y0) / scale,
            (x3 - x2) / scale,
            (y3 - y2) / scale,
            e,
            f,
        )

    def unproject(self, point: Point) -> Point:
        low, high = -60.0, 60.0
        for _ in range(90):
            middle = (low + high) / 2
            if self.project(0.0, middle)[1] < point[1]:
                low = middle
            else:
                high = middle
        z = (low + high) / 2
        x0 = self.project(0.0, z)[0]
        x1 = self.project(1.0, z)[0]
        return (point[0] - x0) / (x1 - x0), z


@dataclass(frozen=True)
class Framing:
    scale: float
    offset_x: float
    offset_y: float

    def apply(self, point: Point) -> Point:
        return (
            self.scale * point[0] + self.offset_x,
            self.scale * point[1] + self.offset_y,
        )

    def invert(self, point: Point) -> Point:
        return (
            (point[0] - self.offset_x) / self.scale,
            (point[1] - self.offset_y) / self.scale,
        )

    def css(self) -> str:
        return (
            f"transform:translate({fmt(self.offset_x)}px,{fmt(self.offset_y)}px) "
            f"scale({self.scale:.4f})"
        )

    def attr(self) -> str:
        return f"translate({fmt(self.offset_x)} {fmt(self.offset_y)}) scale({self.scale:.4f})"


@dataclass(frozen=True)
class Photo:
    name: str
    uri: str
    aspect: float
    correction: int


@dataclass(frozen=True)
class PrintShape:
    width: float
    height: float
    photo_width: float
    photo_height: float


@dataclass(frozen=True)
class Timing:
    scan: float
    mark: float
    lift: float
    flight: float
    land: float
    scatter: float
    scatter_land: float


@dataclass(frozen=True)
class PrintPlan:
    index: int
    photo: Photo
    shape: PrintShape
    slot: Point
    pile: Point
    start_angle: float
    timing: Timing
    glyph: int
    mark_offset: Point
    mark_tilt: float


@dataclass(frozen=True)
class Layer:
    defs: str
    css: str
    markup: str


def fmt(value: float, digits: int = 2) -> str:
    text = f"{value:.{digits}f}".rstrip("0").rstrip(".")
    return "0" if text in ("-0", "", "-") else text


def matrix_values(matrix: Matrix, separator: str) -> str:
    a, b, c, d, e, f = matrix
    return separator.join(
        [fmt(a, 3), fmt(b, 3), fmt(c, 3), fmt(d, 3), fmt(e, 1), fmt(f, 1)]
    )


def matrix_css(matrix: Matrix) -> str:
    return f"transform:matrix({matrix_values(matrix, ',')})"


def matrix_attr(matrix: Matrix) -> str:
    return f"matrix({matrix_values(matrix, ' ')})"


def apply_matrix(matrix: Matrix, point: Point) -> Point:
    a, b, c, d, e, f = matrix
    return a * point[0] + c * point[1] + e, b * point[0] + d * point[1] + f


def rotate_point(point: Point, angle: float) -> Point:
    cos_a, sin_a = math.cos(math.radians(angle)), math.sin(math.radians(angle))
    return point[0] * cos_a - point[1] * sin_a, point[0] * sin_a + point[1] * cos_a


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def make_camera() -> Camera:
    pitch = math.radians(CAMERA_PITCH_DEG)
    target_x, target_z = CAMERA_TARGET
    unit = Camera(
        target_x,
        CAMERA_DISTANCE * math.sin(pitch),
        target_z + CAMERA_DISTANCE * math.cos(pitch),
        math.sin(pitch),
        math.cos(pitch),
        1.0,
    )
    span = (
        unit.project(HOLD_VIEW[1], FRAMING_Z)[0]
        - unit.project(HOLD_VIEW[0], FRAMING_Z)[0]
    )
    return Camera(
        unit.eye_x,
        unit.eye_y,
        unit.eye_z,
        unit.sin_pitch,
        unit.cos_pitch,
        WIDTH / span,
    )


def framing_for(camera: Camera, view: tuple[float, float]) -> Framing:
    left = camera.project(view[0], FRAMING_Z)[0]
    right = camera.project(view[1], FRAMING_Z)[0]
    scale = WIDTH / (right - left)
    edge = camera.project(0.0, MAT_NEAR_Z)[1]
    return Framing(scale, -scale * left, HEIGHT - FRONT_FACE - scale * edge)


def data_uri(image: Image.Image, kind: str) -> str:
    buffer = io.BytesIO()
    if kind == "jpeg":
        image.save(
            buffer,
            "JPEG",
            quality=JPEG_QUALITY,
            optimize=True,
            progressive=True,
            subsampling="4:2:0",
        )
    else:
        image.save(buffer, "PNG", optimize=True)
    return f"data:image/{kind};base64," + base64.b64encode(buffer.getvalue()).decode()


def hex_rgb(color: str) -> tuple[int, int, int]:
    return int(color[1:3], 16), int(color[3:5], 16), int(color[5:7], 16)


def thumbnail(
    image: Image.Image, box: tuple[float, float, float, float]
) -> Image.Image:
    left, top, right, bottom = (round(value) for value in box)
    cropped = image.crop((left, top, right, bottom))
    scale = PHOTO_PX / max(cropped.size)
    size = (round(cropped.width * scale), round(cropped.height * scale))
    resized = cropped.resize(size, Image.LANCZOS, reducing_gap=3.0)
    return resized.filter(ImageFilter.UnsharpMask(radius=0.8, percent=55, threshold=2))


def load_photos() -> list[Photo]:
    sources: dict[str, Image.Image] = {}
    for key, file_name in SAMPLE_FILES.items():
        with Image.open(SAMPLES_OUT_DIR / file_name) as opened:
            sources[key] = ImageOps.exif_transpose(opened).convert("RGB")
    photos = []
    for name in PHOTO_ORDER:
        if name in SAMPLE_FILES:
            source = sources[name]
            box = (0.0, 0.0, float(source.width), float(source.height))
            correction = REAL_CORRECTIONS[name]
        else:
            key, left, top, width = CROP_BOXES[name]
            source = sources[key]
            crop_w = width * source.width
            box = (
                left * source.width,
                top * source.height,
                left * source.width + crop_w,
                top * source.height + crop_w / CROP_ASPECT,
            )
            correction = CROP_CORRECTIONS[name]
        image = thumbnail(source, box)
        photos.append(
            Photo(name, data_uri(image, "jpeg"), image.width / image.height, correction)
        )
    return photos


SHADOW_TEXTURE = 64
SHADOW_INNER = 40
SHADOW_PAD = SHADOW_TEXTURE / SHADOW_INNER


def shadow_png() -> str:
    image = Image.new("L", (SHADOW_TEXTURE, SHADOW_TEXTURE), 0)
    offset = (SHADOW_TEXTURE - SHADOW_INNER) // 2
    ImageDraw.Draw(image).rounded_rectangle(
        [offset, offset, offset + SHADOW_INNER, offset + SHADOW_INNER],
        radius=2,
        fill=255,
    )
    image = image.filter(ImageFilter.GaussianBlur(3))
    layer = Image.new("RGBA", image.size, hex_rgb(SHADOW) + (0,))
    layer.putalpha(image)
    return data_uri(layer, "png")


def mottle_png() -> str:
    rng = random.Random(SEED + 1)
    width, height = 32, 16
    image = Image.new("L", (width, height))
    image.putdata([rng.randint(0, 255) for _ in range(width * height)])
    image = image.resize((width * 4, height * 4), Image.BICUBIC).filter(
        ImageFilter.GaussianBlur(5)
    )
    image = image.resize((width, height), Image.BILINEAR)
    low, high = image.getextrema()
    image = image.point([int(140 * (v - low) / max(1, high - low)) for v in range(256)])
    layer = Image.new("RGBA", image.size, hex_rgb(MAT_DEEP) + (0,))
    layer.putalpha(image)
    return data_uri(layer, "png")


def speckle_png() -> str:
    rng = random.Random(SEED + 2)
    image = Image.new("L", (SPECKLE_PX, SPECKLE_PX), 255)
    draw = ImageDraw.Draw(image)
    for _ in range(SPECKLE_DOTS):
        x, y = rng.uniform(0, SPECKLE_PX), rng.uniform(0, SPECKLE_PX)
        rx, ry = rng.uniform(0.4, 1.0), rng.uniform(0.3, 0.7)
        draw.ellipse([x - rx, y - ry, x + rx, y + ry], fill=rng.choice(SPECKLE_LEVELS))
    return data_uri(image, "png")


def print_shape(aspect: float) -> PrintShape:
    if aspect >= 1:
        long_side = PRINT_LONG / (1 + 2 * BORDER_FRAC / aspect)
        photo_w, photo_h = long_side, long_side / aspect
    else:
        long_side = PRINT_LONG / (1 + 2 * BORDER_FRAC * aspect)
        photo_w, photo_h = long_side * aspect, long_side
    border = BORDER_FRAC * min(photo_w, photo_h)
    return PrintShape(photo_w + 2 * border, photo_h + 2 * border, photo_w, photo_h)


def slot_center(cell: tuple[int, int]) -> Point:
    return MOSAIC_ORIGIN[0] + cell[0] + 0.5, MOSAIC_ORIGIN[1] + cell[1] + 0.5


def write_duration() -> float:
    return MARK_AT + 3 * STROKE_GAP + STROKE_DURATION


def build_timings() -> tuple[list[Timing], float, float]:
    count = len(PHOTO_ORDER)
    first_scan = LOUPE_IN_AT + LOUPE_MOVE
    first_lift = first_scan + write_duration() + LOUPE_DWELL + LOUPE_MOVE + LIFT_PAUSE
    lifts = [first_lift] + [
        first_lift + FIRST_GAP + k * PICK_INTERVAL for k in range(count - 1)
    ]
    flights = [FIRST_FLIGHT] + [FLIGHT] * (count - 1)
    lands = [lift + flight for lift, flight in zip(lifts, flights)]
    scatter_at = max(lands) + HOLD
    timings = []
    for index, (lift, flight, land) in enumerate(zip(lifts, flights, lands)):
        scan = first_scan if index == 0 else lift - write_duration() - LIFT_PAUSE
        scatter = scatter_at + (count - 1 - index) * SCATTER_STAGGER
        timings.append(
            Timing(
                scan,
                scan + MARK_AT,
                lift,
                flight,
                land,
                scatter,
                scatter + SCATTER_FLIGHT,
            )
        )
    cycle = round(max(t.scatter_land for t in timings) + END_REST, 2)
    return timings, cycle, scatter_at


def glyph_variants() -> list[list[str]]:
    rng = random.Random(SEED + 3)
    variants = []
    for _ in range(GLYPH_VARIANTS):
        strokes = []
        for points in TEN_STROKES:
            moved = [
                (
                    x - 50 + rng.uniform(-GLYPH_JITTER, GLYPH_JITTER),
                    y - 50 + rng.uniform(-GLYPH_JITTER, GLYPH_JITTER),
                )
                for x, y in points
            ]
            (x0, y0), (x1, y1), (x2, y2), (x3, y3) = moved
            strokes.append(
                f"M{fmt(x0, 1)} {fmt(y0, 1)}C{fmt(x1, 1)} {fmt(y1, 1)} "
                f"{fmt(x2, 1)} {fmt(y2, 1)} {fmt(x3, 1)} {fmt(y3, 1)}"
            )
        variants.append(strokes)
    return variants


def plan_prints(photos: list[Photo], timings: list[Timing]) -> list[PrintPlan]:
    rng = random.Random(SEED)
    plans = []
    for index, (photo, timing) in enumerate(zip(photos, timings)):
        shape = print_shape(photo.aspect)
        pile_x, pile_z, jitter = PILE_SPOTS[index]
        tilt = rng.uniform(-MARK_TILT_DEG, MARK_TILT_DEG)
        offset = (
            rng.uniform(-MARK_X_JITTER, MARK_X_JITTER) * shape.width,
            -shape.height / 2 + MARK_BOX * MARK_CENTER_FROM_TOP,
        )
        plans.append(
            PrintPlan(
                index,
                photo,
                shape,
                slot_center(SPIRAL[index]),
                (pile_x, pile_z),
                START_ANGLE[photo.correction] + jitter,
                timing,
                index % GLYPH_VARIANTS,
                offset,
                tilt,
            )
        )
    return plans


def mark_transform(plan: PrintPlan) -> str:
    return (
        f"translate({fmt(plan.mark_offset[0])} {fmt(plan.mark_offset[1])}) "
        f"rotate({fmt(plan.mark_tilt)}) scale({MARK_BOX / 100:.3f})"
    )


def desk_corners(center: Point, shape: PrintShape, angle: float) -> list[Point]:
    corners = []
    for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        local = (sx * shape.width / UNIT / 2, sz * shape.height / UNIT / 2)
        dx, dz = rotate_point(local, angle)
        corners.append((center[0] + dx, center[1] + dz))
    return corners


def polygons_overlap(first: list[Point], second: list[Point]) -> bool:
    for polygon in (first, second):
        for k in range(len(polygon)):
            x0, z0 = polygon[k]
            x1, z1 = polygon[(k + 1) % len(polygon)]
            axis = (z0 - z1, x1 - x0)
            a = [p[0] * axis[0] + p[1] * axis[1] for p in first]
            b = [p[0] * axis[0] + p[1] * axis[1] for p in second]
            if max(a) < min(b) or max(b) < min(a):
                return False
    return True


def segment_distance(point: Point, start: Point, end: Point) -> float:
    dx, dy = end[0] - start[0], end[1] - start[1]
    length = dx * dx + dy * dy
    t = (
        0.0
        if length == 0
        else ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length
    )
    t = max(0.0, min(1.0, t))
    return math.hypot(point[0] - start[0] - t * dx, point[1] - start[1] - t * dy)


def circle_touches_polygon(center: Point, radius: float, polygon: list[Point]) -> bool:
    inside = False
    for k in range(len(polygon)):
        x0, y0 = polygon[k]
        x1, y1 = polygon[(k + 1) % len(polygon)]
        if (y0 > center[1]) != (y1 > center[1]):
            cross = x0 + (center[1] - y0) * (x1 - x0) / (y1 - y0)
            if center[0] < cross:
                inside = not inside
        if segment_distance(center, (x0, y0), (x1, y1)) < radius:
            return True
    return inside


def screen_polygon(camera: Camera, corners: list[Point]) -> list[Point]:
    return [camera.project(*corner) for corner in corners]


def pile_polygon(camera: Camera, plan: PrintPlan) -> list[Point]:
    return screen_polygon(camera, desk_corners(plan.pile, plan.shape, plan.start_angle))


def slot_polygon(camera: Camera, plan: PrintPlan) -> list[Point]:
    return screen_polygon(camera, desk_corners(plan.slot, plan.shape, 0.0))


def inside_frame(framing: Framing, polygon: list[Point], headroom: float = 0.0) -> bool:
    for point in polygon:
        x, y = framing.apply(point)
        if not (
            FRAME_MARGIN <= x <= WIDTH - FRAME_MARGIN
            and FRAME_MARGIN + headroom * framing.scale
            <= y
            <= HEIGHT - FRONT_FACE - FRAME_MARGIN
        ):
            return False
    return True


def framing_at(track: list[tuple[float, Framing]], time: float) -> Framing:
    for (t0, f0), (t1, f1) in zip(track, track[1:]):
        if t0 <= time <= t1:
            u = 0.0 if t1 == t0 else (time - t0) / (t1 - t0)
            return Framing(
                lerp(f0.scale, f1.scale, u),
                lerp(f0.offset_x, f1.offset_x, u),
                lerp(f0.offset_y, f1.offset_y, u),
            )
    return track[-1][1]


def check_plan(
    plans: list[PrintPlan],
    camera: Camera,
    track: list[tuple[float, Framing]],
    cycle: float,
    scatter_at: float,
) -> None:
    last_land = max(plan.timing.land for plan in plans)
    assert scatter_at - last_land >= 2.0, "upright hold too short"
    assert 9.0 <= cycle <= 12.0, cycle
    loupe = camera.project(*LOUPE_REST)
    for time, framing in track:
        x, y = framing.apply(loupe)
        reach = (LOUPE_RADIUS + max(LOUPE_SHADOW_REST)) * framing.scale
        assert x + reach < 0 or x - reach > WIDTH or y - reach > HEIGHT, ("loupe", time)
    for plan in plans:
        timing = plan.timing
        assert timing.scatter_land + 0.05 <= cycle
        assert timing.lift - timing.mark < MARK_HIDE_AFTER
        assert timing.mark + MARK_HIDE_AFTER < timing.scatter_land
        landed = desk_corners(plan.slot, plan.shape, 0.0)
        for other in plans:
            if other.timing.lift > timing.land:
                resting = desk_corners(other.pile, other.shape, other.start_angle)
                assert not polygons_overlap(landed, resting), (plan.index, other.index)
        lift_px = FIRST_LIFT_PX if plan.index == 0 else LIFT_PX
        pile_checks = (
            (0.0, 0.0),
            (timing.scan, 0.0),
            (timing.lift, lift_px),
            (timing.lift + PILE_TAIL, lift_px),
        )
        for moment, headroom in pile_checks:
            assert inside_frame(
                framing_at(track, moment), pile_polygon(camera, plan), headroom
            ), (
                "pile print out of frame",
                plan.index,
                moment,
            )
        slot_checks = ((timing.land - SLOT_LEAD, lift_px * 0.5), (timing.land, 0.0))
        for moment, headroom in slot_checks:
            assert inside_frame(
                framing_at(track, moment), slot_polygon(camera, plan), headroom
            ), (
                "slot out of frame",
                plan.index,
                moment,
            )
        assert not circle_touches_polygon(
            loupe, LOUPE_RADIUS, pile_polygon(camera, plan)
        ), (
            "loupe rests on a print",
            plan.index,
        )


def keyframes(name: str, stops: list[Stop], cycle: float) -> str:
    ordered = sorted(stops, key=itemgetter(0))
    for time, _, _ in ordered:
        assert -1e-9 <= time <= cycle + 1e-9, (name, time)
    if ordered[0][0] > 0:
        ordered.insert(0, (0.0, ordered[-1][1], None))
    if ordered[-1][0] < cycle:
        ordered.append((cycle, ordered[0][1], None))
    parts = []
    for time, declaration, easing in ordered:
        percent = f"{min(time, cycle) / cycle * 100:.2f}".rstrip("0").rstrip(".") + "%"
        timing = f";animation-timing-function:{easing}" if easing else ""
        parts.append(f"{percent}{{{declaration}{timing}}}")
    return f"@keyframes {name}{{{''.join(parts)}}}"


def animation(name: str, cycle: float, easing: str = "") -> str:
    suffix = f" {easing}" if easing else ""
    return f".{name}{{animation:{name} {cycle}s infinite{suffix}}}"


def delay(time: float, cycle: float) -> str:
    return f' style="animation-delay:{fmt((time % cycle) - cycle)}s"'


def windows(spans: list[Point]) -> list[Stop]:
    stops: list[Stop] = []
    for on, off in spans:
        stops += [(on, "opacity:1", None), (off, "opacity:0", None)]
    return stops


def copy_windows(plan: PrintPlan) -> dict[str, list[Point]]:
    timing = plan.timing
    lift, flight, scatter = timing.lift, timing.flight, timing.scatter
    cruise_in = (lift + PICK_CRUISE[0] * flight, lift + PICK_CRUISE[1] * flight)
    cruise_out = (
        scatter + SCATTER_CRUISE[0] * SCATTER_FLIGHT,
        scatter + SCATTER_CRUISE[1] * SCATTER_FLIGHT,
    )
    return {
        "w": [(lift, cruise_in[0]), (cruise_in[1], scatter)],
        "c": [cruise_in, cruise_out],
        "x": [(scatter, cruise_out[0]), (cruise_out[1], timing.scatter_land)],
    }


def screen_lift(lift_px: float, height: float) -> str:
    return f"transform:translate(0,{fmt(-lift_px * height)}px)"


def shadow_lift(height: float) -> str:
    lx, lz = SHADOW_LIFT_OFFSET
    return (
        f"transform:translate({fmt(lx * height)}px,{fmt(lz * height)}px) "
        f"scale({1 + SHADOW_LIFT_GROW * height:.3f});opacity:{1 / (1 + 2 * height):.3f}"
    )


def flight_css(
    suffix: str,
    profile: Profile,
    duration: float,
    lift_px: float,
    grow: float,
    cycle: float,
    squash: tuple[tuple[float, float, float, str | None], ...] = (),
) -> str:
    screen = [(u * duration, screen_lift(lift_px, h), e) for u, h, e in profile]
    shade = [(u * duration, shadow_lift(h), e) for u, h, e in profile]
    scale: list[Stop] = [
        (u * duration, f"transform:scale({1 + grow * h:.3f})", e)
        for u, h, e in profile
        if not squash or u < squash[0][0]
    ]
    scale += [
        (u * duration, f"transform:scale({sx:.3f},{sy:.3f})", e)
        for u, sx, sy, e in squash
    ]
    return "".join(
        [
            keyframes(f"l{suffix}", screen, cycle),
            keyframes(f"g{suffix}", scale, cycle),
            keyframes(f"h{suffix}", shade, cycle),
        ]
        + [animation(f"{kind}{suffix}", cycle) for kind in "lgh"]
    )


def shared_css(cycle: float) -> str:
    write = [
        (0.0, "stroke-dashoffset:1.05", EASE_WRITE),
        (STROKE_DURATION, "stroke-dashoffset:0", None),
        (MARK_HIDE_AFTER, "stroke-dashoffset:0", "step-end"),
        (MARK_HIDE_AFTER + SWAP, "stroke-dashoffset:1.05", None),
    ]
    scan_top = -0.5 - SCAN_LEAD * SCAN_BAND
    scan = [
        (0.0, f"transform:translate(0,{fmt(scan_top, 3)}px);opacity:1", EASE_SCAN),
        (SCAN_DURATION, "transform:translate(0,.5px);opacity:1", "step-end"),
        (SCAN_DURATION + SWAP, "transform:translate(0,.5px);opacity:0", None),
        (cycle, f"transform:translate(0,{fmt(scan_top, 3)}px);opacity:0", None),
    ]
    fade = [
        (0.0, "opacity:1", "ease-in"),
        (MARK_FADE, "opacity:0", None),
        (SCATTER_FLIGHT + 3 * SWAP, "opacity:0", "step-end"),
        (SCATTER_FLIGHT + 4 * SWAP, "opacity:1", None),
        (cycle, "opacity:1", None),
    ]
    return "".join(
        [
            flight_css("p", PICK_LIFT, FLIGHT, LIFT_PX, LIFT_SCALE, cycle),
            flight_css(
                "f",
                FIRST_LIFT,
                FIRST_FLIGHT,
                FIRST_LIFT_PX,
                FIRST_LIFT_SCALE,
                cycle,
                FIRST_SQUASH,
            ),
            flight_css(
                "s",
                SCATTER_LIFT,
                SCATTER_FLIGHT,
                SCATTER_LIFT_PX,
                SCATTER_LIFT_SCALE,
                cycle,
            ),
            keyframes("wr", write, cycle),
            keyframes("sc", scan, cycle),
            keyframes("nf", fade, cycle),
            animation("wr", cycle),
            animation("sc", cycle),
            animation("nf", cycle),
        ]
    )


def print_css(plan: PrintPlan, camera: Camera, cycle: float) -> str:
    timing = plan.timing
    index = plan.index
    pile = matrix_css(camera.desk_matrix(*plan.pile))
    slot = matrix_css(camera.desk_matrix(*plan.slot))
    travel_a, travel_b, travel_ease = PICK_TRAVEL
    spin_a, spin_b, spin_ease = FIRST_SPIN if index == 0 else PICK_SPIN
    back_a, back_b, back_ease = SCATTER_TRAVEL
    turn_a, turn_b, turn_ease = SCATTER_SPIN
    lift, flight = timing.lift, timing.flight
    scatter = timing.scatter
    rotate_start = f"transform:rotate({fmt(plan.start_angle)}deg)"
    rotate_end = "transform:rotate(0deg)"
    travel = [
        (lift + travel_a * flight, pile, travel_ease),
        (lift + travel_b * flight, slot, None),
        (scatter + back_a * SCATTER_FLIGHT, slot, back_ease),
        (scatter + back_b * SCATTER_FLIGHT, pile, None),
    ]
    spin = [
        (lift + spin_a * flight, rotate_start, spin_ease),
        (lift + spin_b * flight, rotate_end, None),
        (scatter + turn_a * SCATTER_FLIGHT, rotate_end, turn_ease),
        (scatter + turn_b * SCATTER_FLIGHT, rotate_start, None),
    ]
    rest: list[Stop] = [
        (lift, "opacity:0", None),
        (timing.scatter_land, "opacity:1", None),
    ]
    return "".join(
        [
            keyframes(f"t{index}", travel, cycle),
            keyframes(f"r{index}", spin, cycle),
            keyframes(f"v{index}", rest, cycle),
        ]
        + [
            keyframes(f"{kind}{index}", windows(spans), cycle)
            for kind, spans in copy_windows(plan).items()
        ]
        + [animation(f"{kind}{index}", cycle) for kind in "tr"]
        + [animation(f"{kind}{index}", cycle, "step-end") for kind in "vwcx"]
    )


def monotone_samples(points: list[Point], step: float) -> list[Point]:
    times = [p[0] for p in points]
    values = [p[1] for p in points]
    count = len(points)
    slopes = [
        (values[k + 1] - values[k]) / (times[k + 1] - times[k])
        for k in range(count - 1)
    ]
    tangents = [0.0] * count
    for k in range(1, count - 1):
        if slopes[k - 1] * slopes[k] > 0:
            tangents[k] = 2 / (1 / slopes[k - 1] + 1 / slopes[k])
    samples = []
    for k in range(count - 1):
        t0, t1 = times[k], times[k + 1]
        span = t1 - t0
        steps = max(1, round(span / step))
        for s in range(steps):
            u = s / steps
            value = (
                (2 * u**3 - 3 * u**2 + 1) * values[k]
                + (u**3 - 2 * u**2 + u) * span * tangents[k]
                + (-2 * u**3 + 3 * u**2) * values[k + 1]
                + (u**3 - u**2) * span * tangents[k + 1]
            )
            samples.append((t0 + u * span, value))
    samples.append((times[-1], values[-1]))
    return samples


def camera_track(
    camera: Camera, plans: list[PrintPlan], cycle: float, scatter_at: float
) -> list[tuple[float, Framing]]:
    last_land = max(plan.timing.land for plan in plans)
    waypoints = [(0.0, OPEN_VIEW[0], OPEN_VIEW[1])]
    for kind, index, shift, left, right in CAMERA_WAYPOINTS:
        if kind == "lift":
            time = plans[index].timing.lift
        elif kind == "land":
            time = plans[index].timing.land
        else:
            time = last_land
        waypoints.append((time + shift, left, right))
    waypoints += [
        (scatter_at, HOLD_VIEW[0], HOLD_VIEW[1]),
        (scatter_at + SCATTER_FLIGHT, SCATTER_VIEW[0], SCATTER_VIEW[1]),
        (cycle - 0.06, OPEN_VIEW[0], OPEN_VIEW[1]),
        (cycle, OPEN_VIEW[0], OPEN_VIEW[1]),
    ]
    lefts = monotone_samples(
        [(t, left) for t, left, _ in waypoints], CAMERA_SAMPLE_STEP
    )
    rights = monotone_samples(
        [(t, right) for t, _, right in waypoints], CAMERA_SAMPLE_STEP
    )
    return [
        (t, framing_for(camera, (left, right)))
        for (t, left), (_, right) in zip(lefts, rights)
    ]


def camera_css(track: list[tuple[float, Framing]], cycle: float) -> str:
    stops: list[Stop] = [(t, framing.css(), None) for t, framing in track]
    return keyframes("cam", stops, cycle) + animation("cam", cycle, "linear")


def desk_line(camera: Camera, start: Point, end: Point) -> str:
    x0, y0 = camera.project(*start)
    x1, y1 = camera.project(*end)
    if abs(y0 - y1) < 0.05:
        return f"M{x0:.1f} {y0:.1f}H{x1:.1f}"
    return f"M{x0:.1f} {y0:.1f}L{x1:.1f} {y1:.1f}"


def frame_corners(framing: Framing) -> list[Point]:
    return [
        framing.invert(corner)
        for corner in ((0.0, 0.0), (WIDTH, 0.0), (0.0, HEIGHT), (WIDTH, HEIGHT))
    ]


def visible_desk(camera: Camera, framings: list[Framing]) -> tuple[float, float, float]:
    xs, zs = [], []
    for framing in framings:
        for corner in frame_corners(framing):
            x, z = camera.unproject(corner)
            xs.append(x)
            zs.append(z)
    return (
        math.floor(min(xs) * 10) / 10 - MAT_OVERSCAN,
        math.ceil(max(xs) * 10) / 10 + MAT_OVERSCAN,
        max(math.floor(min(zs) * 10) / 10, -9.0),
    )


def mat_layer(
    camera: Camera, framings: list[Framing], rest_framings: list[Framing]
) -> str:
    x_min, x_max, z_far = visible_desk(camera, framings)
    corners = [corner for framing in framings for corner in frame_corners(framing)]
    left = min(p[0] for p in corners) - MAT_OVERSCAN_PX
    top = min(p[1] for p in corners) - 4
    width = max(p[0] for p in corners) + MAT_OVERSCAN_PX - left
    height = max(p[1] for p in corners) + 4 - top
    box = f'x="{fmt(left)}" y="{fmt(top)}" width="{fmt(width)}" height="{fmt(height)}"'
    parts = [
        f'<rect {box} fill="{MAT}"/>',
        f'<image {box} preserveAspectRatio="none" opacity=".35" xlink:href="{mottle_png()}"/>',
    ]
    minor, major = [], []
    for k in range(int(round((x_max - x_min) * 10)) + 1):
        x = x_min + k / 10
        is_major = abs(x - round(x)) < 1e-6
        far = z_far if is_major else max(z_far, MINOR_GRID_FAR_Z)
        (major if is_major else minor).append(
            desk_line(camera, (x, far), (x, MAT_NEAR_Z))
        )
    for k in range(int(round((MAT_NEAR_Z - z_far) * 10)) + 1):
        z = z_far + k / 10
        is_major = abs(z - round(z)) < 1e-6
        if is_major or z >= MINOR_GRID_FAR_Z:
            (major if is_major else minor).append(
                desk_line(camera, (x_min, z), (x_max, z))
            )
    parts.append(
        f'<path d="{"".join(minor)}" stroke="{MAT_LINE}" stroke-opacity=".1" '
        f'stroke-width=".7" fill="none"/>'
    )
    parts.append(
        f'<path d="{"".join(major)}" stroke="{MAT_LINE}" stroke-opacity=".28" '
        f'stroke-width="1.1" fill="none"/>'
    )
    center_x, center_z = MOSAIC_ORIGIN[0] + 2.5, MOSAIC_ORIGIN[1] + 1.5
    diagonals = [
        desk_line(
            camera, (center_x - 7, center_z - 7 * s), (center_x + 7, center_z + 7 * s)
        )
        for s in (1, -1)
    ]
    parts.append(
        f'<path d="{"".join(diagonals)}" stroke="{MAT_LINE}" stroke-opacity=".14" '
        f'stroke-width=".9" stroke-dasharray="6 7" fill="none"/>'
    )
    parts.append(ruler(camera, x_min, x_max, rest_framings))
    return "".join(parts)


def ruler(camera: Camera, x_min: float, x_max: float, framings: list[Framing]) -> str:
    ticks = [desk_line(camera, (x_min, RULER_Z), (x_max, RULER_Z))]
    for k in range(math.ceil(x_min * 10), math.floor(x_max * 10) + 1):
        if k % 10 == 0:
            length = RULER_TICKS[2]
        elif k % 5 == 0:
            length = RULER_TICKS[1]
        else:
            length = RULER_TICKS[0]
        ticks.append(desk_line(camera, (k / 10, RULER_Z), (k / 10, RULER_Z - length)))
    numerals = []
    for x in range(math.ceil(x_min), math.floor(x_max) + 1):
        anchor = camera.project(x, RULER_NUMERAL_Z)
        straddles = False
        for framing in framings:
            center = framing.apply(anchor)[0]
            half = RULER_NUMERAL_HALF * framing.scale
            low, high = center - half, center + half
            if (low < 0 < high) or (low < WIDTH < high):
                straddles = True
        if straddles:
            continue
        label = round((x - RULER_ORIGIN) * 10)
        numerals.append(
            f'<text transform="{matrix_attr(camera.desk_matrix(x, RULER_NUMERAL_Z))}">{label}</text>'
        )
    return (
        f'<path d="{"".join(ticks)}" stroke="{MAT_LINE}" stroke-opacity=".6" '
        f'stroke-width="1.1" fill="none"/>'
        f'<g fill="{CHALK_SOFT}" fill-opacity=".85" font-family="{FONT_SANS}" '
        f'font-size="{fmt(RULER_FONT)}" text-anchor="middle">{"".join(numerals)}</g>'
    )


def print_defs(plans: list[PrintPlan], glyphs: list[list[str]]) -> str:
    tile = fmt(SPECKLE_TILE)
    half = fmt(-SPECKLE_TILE / 2)
    parts = [
        '<clipPath id="unit"><rect x="-.5" y="-.5" width="1" height="1"/></clipPath>',
        f'<clipPath id="unitx"><rect x="{fmt(-0.5 - SCAN_LINE_OVERHANG, 3)}" y="-.5" '
        f'width="{fmt(1 + 2 * SCAN_LINE_OVERHANG, 3)}" height="1"/></clipPath>',
        f'<image id="sh" width="1" height="1" preserveAspectRatio="none" xlink:href="{shadow_png()}"/>',
        f'<linearGradient id="scan" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0" stop-color="{SCAN_LIGHT}" stop-opacity="0"/>'
        f'<stop offset=".45" stop-color="{SCAN_LIGHT}" stop-opacity=".6"/>'
        f'<stop offset="{SCAN_LEAD - 0.02}" stop-color="{SCAN_LIGHT}" stop-opacity=".92"/>'
        f'<stop offset="{SCAN_LEAD}" stop-color="{WHITE}" stop-opacity="1"/>'
        f'<stop offset="1" stop-color="{SCAN_LIGHT}" stop-opacity="0"/></linearGradient>',
        f'<linearGradient id="sl" x1="0" y1="0" x2="1" y2="0">'
        f'<stop offset="0" stop-color="{WHITE}" stop-opacity="0"/>'
        f'<stop offset=".08" stop-color="{WHITE}"/><stop offset=".92" stop-color="{WHITE}"/>'
        f'<stop offset="1" stop-color="{WHITE}" stop-opacity="0"/></linearGradient>',
        f'<pattern id="spp" patternUnits="userSpaceOnUse" x="{half}" y="{half}" '
        f'width="{tile}" height="{tile}"><image width="{tile}" height="{tile}" '
        f'xlink:href="{speckle_png()}"/></pattern>',
        f'<mask id="spk" maskUnits="userSpaceOnUse" x="{half}" y="{half}" width="{tile}" '
        f'height="{tile}"><rect x="{half}" y="{half}" width="{tile}" height="{tile}" '
        f'fill="url(#spp)"/></mask>',
    ]
    for variant, strokes in enumerate(glyphs):
        parts.append(
            f'<path id="K{variant}" d="{"".join(strokes)}" fill="none" stroke="{MARKER}" '
            f'stroke-width="{fmt(MARK_STROKE)}" stroke-linecap="round" stroke-linejoin="round" '
            f'mask="url(#spk)"/>'
        )
        for k, stroke in enumerate(strokes):
            parts.append(f'<path id="S{variant}{k}" pathLength="1" d="{stroke}"/>')
    for plan in plans:
        shape = plan.shape
        index = plan.index
        shadow_w, shadow_h = shape.width * SHADOW_PAD, shape.height * SHADOW_PAD
        parts.append(
            f'<g id="c{index}"><rect x="{fmt(-shape.width / 2)}" y="{fmt(-shape.height / 2)}" '
            f'width="{fmt(shape.width)}" height="{fmt(shape.height)}" rx="1" fill="{PAPER}" '
            f'stroke="{SHADOW}" stroke-opacity=".22" stroke-width=".7"/>'
            f'<image x="{fmt(-shape.photo_width / 2)}" y="{fmt(-shape.photo_height / 2)}" '
            f'width="{fmt(shape.photo_width)}" height="{fmt(shape.photo_height)}" '
            f'preserveAspectRatio="none" xlink:href="{plan.photo.uri}"/></g>'
            f'<use id="h{index}" xlink:href="#sh" transform="translate({fmt(-shadow_w / 2)} '
            f'{fmt(-shadow_h / 2)}) scale({fmt(shadow_w)} {fmt(shadow_h)})"/>'
            f'<g id="k{index}" transform="{mark_transform(plan)}">'
            f'<use xlink:href="#K{plan.glyph}"/></g>'
        )
    return "".join(parts)


def rest_shadow(index: int, angle: float) -> str:
    rx, rz = SHADOW_REST_OFFSET
    return (
        f'<g transform="translate({fmt(rx)} {fmt(rz)})" opacity="{SHADOW_REST_ALPHA}">'
        f'<g transform="rotate({fmt(angle)})"><use xlink:href="#h{index}"/></g></g>'
    )


def write_on(plan: PrintPlan, cycle: float) -> str:
    uses = "".join(
        f'<use class="wr"{delay(plan.timing.mark + k * STROKE_GAP, cycle)} '
        f'xlink:href="#S{plan.glyph}{k}"/>'
        for k in range(4)
    )
    return (
        f'<g transform="{mark_transform(plan)}" fill="none" stroke="{MARKER}" '
        f'stroke-width="{fmt(MARK_STROKE)}" stroke-linecap="round" stroke-linejoin="round" '
        f'stroke-dasharray="1 1.1" stroke-dashoffset="1.05"><g mask="url(#spk)">{uses}</g></g>'
    )


def scan_light(plan: PrintPlan, cycle: float) -> str:
    wait = delay(plan.timing.scan, cycle)
    line_y = SCAN_LEAD * SCAN_BAND - SCAN_LINE / 2
    return (
        f'<g transform="scale({fmt(plan.shape.width)} {fmt(plan.shape.height)})">'
        f'<g clip-path="url(#unit)"><rect class="sc"{wait} x="-.5" y="0" width="1" '
        f'height="{fmt(SCAN_BAND)}" fill="url(#scan)" opacity="0"/></g>'
        f'<g clip-path="url(#unitx)"><rect class="sc"{wait} '
        f'x="{fmt(-0.5 - SCAN_LINE_OVERHANG, 3)}" y="{fmt(line_y, 3)}" '
        f'width="{fmt(1 + 2 * SCAN_LINE_OVERHANG, 3)}" height="{fmt(SCAN_LINE, 3)}" '
        f'fill="url(#sl)" opacity="0"/></g></g>'
    )


def pile_pose(plan: PrintPlan, camera: Camera, cycle: float, live: bool) -> str:
    body = f'<use xlink:href="#c{plan.index}"/>'
    if live:
        body += scan_light(plan, cycle) + write_on(plan, cycle)
    return (
        f'<g transform="{matrix_attr(camera.desk_matrix(*plan.pile))}">'
        f"{rest_shadow(plan.index, plan.start_angle)}"
        f'<g transform="rotate({fmt(plan.start_angle)})">{body}</g></g>'
    )


def pile_copy(plan: PrintPlan, camera: Camera, cycle: float) -> str:
    visible = 1 if plan.index > STILL_PLACED else 0
    return (
        f'<g class="v{plan.index}" opacity="{visible}">'
        f"{pile_pose(plan, camera, cycle, True)}</g>"
    )


def still_pose(plan: PrintPlan, camera: Camera) -> tuple[str, str, float]:
    if plan.index < STILL_PLACED:
        return matrix_attr(camera.desk_matrix(*plan.slot)), "0", 0.0
    if plan.index == STILL_PLACED:
        pile = camera.desk_matrix(*plan.pile)
        slot = camera.desk_matrix(*plan.slot)
        a, b, c, d, e, f = (lerp(p, s, STILL_TRAVEL) for p, s in zip(pile, slot))
        angle = plan.start_angle * (1 - STILL_TURN)
        return matrix_attr((a, b, c, d, e, f)), fmt(angle), STILL_LIFT
    return matrix_attr(camera.desk_matrix(*plan.pile)), fmt(plan.start_angle), 0.0


def flying_copy(
    plan: PrintPlan,
    camera: Camera,
    cycle: float,
    visibility: str,
    flights: list[tuple[str, float]],
    fade_at: float | None,
) -> str:
    index = plan.index
    in_still = visibility == "w" and index <= STILL_PLACED
    matrix_text, angle_text, height = still_pose(plan, camera)
    still_matrix = f' transform="{matrix_text}"' if in_still else ""
    still_angle = f' transform="rotate({angle_text})"' if in_still else ""
    shade_attr = lift_attr = grow_attr = ""
    if in_still and height:
        lx, lz = SHADOW_LIFT_OFFSET
        lift_px = FIRST_LIFT_PX if index == 0 else LIFT_PX
        grow = FIRST_LIFT_SCALE if index == 0 else LIFT_SCALE
        shade_attr = (
            f' transform="translate({fmt(lx * height)} {fmt(lz * height)}) '
            f'scale({1 + SHADOW_LIFT_GROW * height:.3f})" '
            f'opacity="{1 / (1 + 2 * height):.3f}"'
        )
        lift_attr = f' transform="translate(0 {fmt(-lift_px * height)})"'
        grow_attr = f' transform="scale({1 + grow * height:.3f})"'

    def nest(prefix: str, attr: str, inner: str) -> str:
        opened = "".join(
            f'<g class="{prefix}{kind}"{delay(start, cycle)}>'
            for kind, start in flights
        )
        opened = opened.replace(">", f"{attr}>", 1) if attr else opened
        return opened + inner + "</g>" * len(flights)

    rx, rz = SHADOW_REST_OFFSET
    mark = f'<use xlink:href="#k{index}"/>'
    if fade_at is not None:
        mark = f'<g class="nf"{delay(fade_at, cycle)}>{mark}</g>'
    shadow = nest(
        "h",
        shade_attr,
        f'<g class="r{index}"{still_angle}><use xlink:href="#h{index}"/></g>',
    )
    card = nest(
        "g",
        grow_attr,
        f'<g class="r{index}"{still_angle}><use xlink:href="#c{index}"/>{mark}</g>',
    )
    lifted = nest("l", lift_attr, f'<g class="t{index}"{still_matrix}>{card}</g>')
    return (
        f'<g class="{visibility}{index}" opacity="{1 if in_still else 0}">'
        f'<g class="t{index}"{still_matrix}>'
        f'<g transform="translate({fmt(rx)} {fmt(rz)})" opacity="{SHADOW_REST_ALPHA}">'
        f"{shadow}</g></g>{lifted}</g>"
    )


def pick_copy(plan: PrintPlan, camera: Camera, cycle: float) -> str:
    kind = "f" if plan.index == 0 else "p"
    return flying_copy(plan, camera, cycle, "w", [(kind, plan.timing.lift)], None)


def scatter_copy(plan: PrintPlan, camera: Camera, cycle: float) -> str:
    scatter = plan.timing.scatter
    return flying_copy(plan, camera, cycle, "x", [("s", scatter)], scatter)


def cruise_copy(plan: PrintPlan, camera: Camera, cycle: float) -> str:
    kind = "f" if plan.index == 0 else "p"
    flights = [(kind, plan.timing.lift), ("s", plan.timing.scatter)]
    return flying_copy(plan, camera, cycle, "c", flights, plan.timing.scatter)


def mark_center(plan: PrintPlan, camera: Camera) -> Point:
    local = (plan.mark_offset[0], plan.mark_offset[1] + MARK_BOX * MARK_VISUAL_CENTER)
    return apply_matrix(
        camera.desk_matrix(*plan.pile), rotate_point(local, plan.start_angle)
    )


def loupe_layer(plans: list[PrintPlan], camera: Camera, cycle: float) -> Layer:
    cx, cy = camera.project(*LOUPE_REST)
    target = mark_center(plans[0], camera)
    dx, dy = target[0] - cx, target[1] - cy
    arrive = (LOUPE_IN_AT, LOUPE_IN_AT + LOUPE_MOVE)
    write_end = plans[0].timing.mark + 3 * STROKE_GAP + STROKE_DURATION
    leave = (write_end + LOUPE_DWELL, write_end + LOUPE_DWELL + LOUPE_MOVE)

    def track(name: str, moved: str, rest: str, easing_in: str, easing_out: str) -> str:
        stops: list[Stop] = [
            (arrive[0], rest, easing_in),
            (arrive[1], moved, None),
            (leave[0], moved, easing_out),
            (leave[1], rest, None),
        ]
        return keyframes(name, stops, cycle) + animation(name, cycle)

    origin = "transform:translate(0,0)"
    shadow_dx = LOUPE_SHADOW_HOVER[0] - LOUPE_SHADOW_REST[0]
    shadow_dy = LOUPE_SHADOW_HOVER[1] - LOUPE_SHADOW_REST[1]
    css = "".join(
        [
            track(
                "lxa",
                f"transform:translate({fmt(dx)}px,0)",
                origin,
                EASE_IN_OUT_CUBIC,
                EASE_IN_OUT_CUBIC,
            ),
            track(
                "lya", f"transform:translate(0,{fmt(dy)}px)", origin, EASE_OUT, EASE_IN
            ),
            track(
                "lxb",
                f"transform:translate({fmt(-dx)}px,0)",
                origin,
                EASE_IN_OUT_CUBIC,
                EASE_IN_OUT_CUBIC,
            ),
            track(
                "lyb", f"transform:translate(0,{fmt(-dy)}px)", origin, EASE_OUT, EASE_IN
            ),
            track(
                "lsd",
                f"transform:translate({fmt(shadow_dx)}px,{fmt(shadow_dy)}px);opacity:.7",
                f"{origin};opacity:1",
                EASE_OUT,
                EASE_IN,
            ),
        ]
    )
    radius = LOUPE_RADIUS
    glass = radius - LOUPE_RING
    view = glass / LOUPE_ZOOM
    lens_cards = []
    for plan in reversed(plans):
        polygon = pile_polygon(camera, plan)
        near = any(
            circle_touches_polygon(
                (lerp(cx, target[0], u / 12), lerp(cy, target[1], u / 12)),
                view + 2,
                polygon,
            )
            for u in range(13)
        )
        if near or plan.index == 0:
            lens_cards.append(pile_pose(plan, camera, cycle, plan.index == 0))
    zoom = f"translate({fmt(cx)} {fmt(cy)}) scale({LOUPE_ZOOM}) translate({fmt(-cx)} {fmt(-cy)})"
    sx, sy = LOUPE_SHADOW_REST
    arc_r, inner_r = glass * 0.8, glass * 0.64
    a0, a1 = math.radians(196), math.radians(262)
    glint = (
        f"M{fmt(cx + arc_r * math.cos(a0))} {fmt(cy + arc_r * math.sin(a0))}"
        f"A{fmt(arc_r)} {fmt(arc_r)} 0 0 1 {fmt(cx + arc_r * math.cos(a1))} "
        f"{fmt(cy + arc_r * math.sin(a1))}"
        f"A{fmt(arc_r * 1.7)} {fmt(arc_r * 1.7)} 0 0 0 {fmt(cx + inner_r * math.cos(a0))} "
        f"{fmt(cy + inner_r * math.sin(a0))}Z"
    )
    center = f'cx="{fmt(cx)}" cy="{fmt(cy)}"'
    ring_r = fmt(radius - LOUPE_RING / 2)
    defs = (
        f'<clipPath id="lens"><circle {center} r="{fmt(glass)}"/></clipPath>'
        f'<radialGradient id="lsh" cx=".5" cy=".5" r=".5">'
        f'<stop offset=".5" stop-color="{SHADOW}" stop-opacity=".55"/>'
        f'<stop offset="1" stop-color="{SHADOW}" stop-opacity="0"/></radialGradient>'
        f'<linearGradient id="steel" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{WHITE}" stop-opacity=".85"/>'
        f'<stop offset=".38" stop-color="{WHITE}" stop-opacity="0"/>'
        f'<stop offset=".62" stop-color="{BLACK}" stop-opacity="0"/>'
        f'<stop offset="1" stop-color="{BLACK}" stop-opacity=".5"/></linearGradient>'
        f'<radialGradient id="glass" cx=".5" cy=".5" r=".5">'
        f'<stop offset=".7" stop-color="{SHADOW}" stop-opacity="0"/>'
        f'<stop offset="1" stop-color="{SHADOW}" stop-opacity=".45"/></radialGradient>'
        f'<linearGradient id="glint" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{WHITE}" stop-opacity=".8"/>'
        f'<stop offset=".6" stop-color="{WHITE}" stop-opacity="0"/></linearGradient>'
    )
    markup = (
        f'<g class="lxa"><g class="lya">'
        f'<ellipse class="lsd" cx="{fmt(cx + sx)}" cy="{fmt(cy + sy)}" rx="{fmt(radius * 1.1)}" '
        f'ry="{fmt(radius * 0.86)}" fill="url(#lsh)"/>'
        f'<g clip-path="url(#lens)"><g transform="{zoom}"><g class="lxb"><g class="lyb">'
        f'<use xlink:href="#matb"/>{"".join(lens_cards)}</g></g></g>'
        f'<circle {center} r="{fmt(glass)}" fill="{SCAN_LIGHT}" fill-opacity=".06"/>'
        f'<circle {center} r="{fmt(glass)}" fill="url(#glass)"/>'
        f'<path d="{glint}" fill="url(#glint)"/></g>'
        f'<circle {center} r="{ring_r}" fill="none" stroke="{STEEL}" stroke-width="{fmt(LOUPE_RING)}"/>'
        f'<circle {center} r="{ring_r}" fill="none" stroke="url(#steel)" '
        f'stroke-width="{fmt(LOUPE_RING)}"/>'
        f'<circle {center} r="{fmt(radius - 0.6)}" fill="none" stroke="{SHADOW}" '
        f'stroke-opacity=".6" stroke-width="1.2"/>'
        f'<circle {center} r="{fmt(radius - 3)}" fill="none" stroke="{WHITE}" '
        f'stroke-opacity=".35" stroke-width="1"/>'
        f'<circle {center} r="{fmt(glass + 0.5)}" fill="none" stroke="{SHADOW}" '
        f'stroke-opacity=".5" stroke-width="1"/>'
        f"</g></g>"
    )
    return Layer(defs, css, markup)


def screen_layer() -> Layer:
    defs = (
        f'<clipPath id="frame"><rect width="{WIDTH}" height="{HEIGHT}" rx="{FRAME_RADIUS}"/></clipPath>'
        f'<radialGradient id="lamp" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" '
        f'gradientTransform="translate({WIDTH * 0.55:.0f} {HEIGHT * 0.52:.0f}) '
        f'scale({WIDTH * 0.5:.0f} {HEIGHT * 0.5:.0f})">'
        f'<stop offset="0" stop-color="{SCAN_LIGHT}" stop-opacity=".13"/>'
        f'<stop offset=".6" stop-color="{SCAN_LIGHT}" stop-opacity=".04"/>'
        f'<stop offset="1" stop-color="{SCAN_LIGHT}" stop-opacity="0"/></radialGradient>'
        f'<linearGradient id="fog" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0" stop-color="{MAT_DEEP}" stop-opacity=".9"/>'
        f'<stop offset=".1" stop-color="{MAT_DEEP}" stop-opacity=".4"/>'
        f'<stop offset=".26" stop-color="{MAT_DEEP}" stop-opacity="0"/></linearGradient>'
        f'<radialGradient id="vig" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" '
        f'gradientTransform="translate({WIDTH / 2:.0f} {HEIGHT * 0.5:.0f}) '
        f'scale({WIDTH * 0.62:.0f} {HEIGHT * 0.78:.0f})">'
        f'<stop offset=".62" stop-color="{MAT_DEEP}" stop-opacity="0"/>'
        f'<stop offset="1" stop-color="{MAT_DEEP}" stop-opacity=".7"/></radialGradient>'
    )
    markup = (
        f'<rect width="{WIDTH}" height="{HEIGHT}" fill="url(#lamp)"/>'
        f'<rect width="{WIDTH}" height="{HEIGHT}" fill="url(#fog)"/>'
        f'<rect width="{WIDTH}" height="{HEIGHT}" fill="url(#vig)"/>'
    )
    return Layer(defs, "", markup)


def front_face() -> str:
    top = HEIGHT - FRONT_FACE
    return (
        f'<rect y="{top}" width="{WIDTH}" height="{FRONT_FACE}" fill="{MAT_DEEP}"/>'
        f'<rect y="{top}" width="{WIDTH}" height="1.2" fill="{MAT_LINE}" fill-opacity=".35"/>'
    )


def build_svg() -> str:
    camera = make_camera()
    timings, cycle, scatter_at = build_timings()
    plans = plan_prints(load_photos(), timings)
    track = camera_track(camera, plans, cycle, scatter_at)
    check_plan(plans, camera, track, cycle, scatter_at)
    still = framing_for(camera, STILL_VIEW)
    rest_framings = [
        framing_for(camera, OPEN_VIEW),
        framing_for(camera, HOLD_VIEW),
        still,
    ]
    framings = [framing for _, framing in track] + rest_framings
    loupe = loupe_layer(plans, camera, cycle)
    screen = screen_layer()
    css = "".join(
        [shared_css(cycle), camera_css(track, cycle), loupe.css]
        + [print_css(plan, camera, cycle) for plan in plans]
    )
    rest = "".join(pile_copy(plan, camera, cycle) for plan in reversed(plans))
    picks = "".join(pick_copy(plan, camera, cycle) for plan in plans)
    scatters = "".join(scatter_copy(plan, camera, cycle) for plan in reversed(plans))
    cruises = "".join(cruise_copy(plan, camera, cycle) for plan in reversed(plans))
    style = (
        "<style>g,use,rect,path,circle,ellipse,text{transform-origin:0 0}"
        f"@media (prefers-reduced-motion:no-preference){{{css}}}</style>"
    )
    defs = print_defs(plans, glyph_variants()) + loupe.defs + screen.defs
    still_attr = still.attr()
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        f'viewBox="0 0 {WIDTH} {HEIGHT}" width="{WIDTH}" height="{HEIGHT}" role="img" '
        f'aria-label="{DESCRIPTION}"><title>{TITLE}</title>{style}<defs>{defs}</defs>'
        f'<g clip-path="url(#frame)"><rect width="{WIDTH}" height="{HEIGHT}" fill="{MAT_DEEP}"/>'
        f'<g class="cam" transform="{still_attr}"><g id="matb">'
        f"{mat_layer(camera, framings, rest_framings)}</g></g>{screen.markup}"
        f'<g class="cam" transform="{still_attr}">{rest}{loupe.markup}{picks}{scatters}{cruises}</g>'
        f"{front_face()}</g></svg>"
    )


def main() -> None:
    svg = build_svg()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(svg, encoding="utf-8")
    print(f"wrote {OUTPUT_PATH.relative_to(REPO_ROOT)} ({len(svg.encode())} bytes)")


if __name__ == "__main__":
    main()
