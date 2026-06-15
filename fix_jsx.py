import os

jsx_file = os.path.join(os.getcwd(), 'src', 'components', 'MeshModifier.jsx')

with open(jsx_file, 'r', encoding='utf-8') as f:
    content = f.read()

# Sostituisci i \n letterali con veri newline
content = content.replace('\\n', '\n')

with open(jsx_file, 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ File MeshModifier.jsx corretto!")
