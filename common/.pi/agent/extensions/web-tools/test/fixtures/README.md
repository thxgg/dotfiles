# Media fixtures

These files are 1×1 red images. They were generated locally with ImageMagick:

```bash
for format in png jpg gif webp bmp; do
  magick -size 1x1 xc:red -strip pixel.$format
done
```

Tests read these files directly. ImageMagick is not a test dependency.
