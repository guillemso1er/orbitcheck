import cairosvg
from PIL import Image
import io

# 1. Define the input and your desired output sizes
input_svg = "favicon.svg"
sizes = {
    "favicon-16x16.png": 16,
    "favicon-32x32.png": 32,
    "apple-touch-icon.png": 180
}

# 2. Generate the PNGs
for filename, size in sizes.items():
    cairosvg.svg2png(url=input_svg, write_to=filename, output_width=size, output_height=size)
    print(f"Created {filename}")

# 3. Generate the .ico (Combined 16, 32, 48 sizes is standard)
# We will use the 32x32 png we just made as a base, but ideally we generate a hi-res one
cairosvg.svg2png(url=input_svg, write_to="temp_256.png", output_width=256, output_height=256)
img = Image.open("temp_256.png")
img.save("favicon.ico", format='ICO', sizes=[(16,16), (32,32), (48,48), (256,256)])
print("Created favicon.ico")