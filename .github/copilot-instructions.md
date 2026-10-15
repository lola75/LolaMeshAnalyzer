# GitHub Copilot Instructions

## Project Overview
This is a modern web application for analyzing and visualizing 3D mesh files (STL, OBJ, PLY) with integrated metadata editing capabilities.

## Development Workflow

### When Adding New Features
1. Create new React components in `src/components/`
2. Add utility functions to `src/utils/` as needed
3. Import and use Tailwind CSS for styling
4. Organize components by feature under `src/components/<feature>/` with one component per file. Separate presentation logic from data-fetching logic using the container/presentational pattern (e.g., `FileUploaderContainer.jsx` for logic, `FileUploader.jsx` for UI).

### When Fixing Bugs
**Decision Tree Approach:**
- **Step A (Parser Failures)**: If a loader throws or returns null/undefined, catch the error and log it with file metadata. Show a user-facing error 'Unable to parse file: <reason>' and create an automated bug report template with file hash and loader stack trace. Add unit tests for the specific loader. If parser seems fine, proceed to Step B.
- **Step B (Geometry Issues)**: If geometry topology looks incorrect, inspect buffer attributes and transform pipeline. Check for missing normals, wrong vertex order, or scale mismatches. Detect unusually high vertex counts (>1M) and downsample or prompt user to simplify mesh. If renderer memory approaches limit, fallback to low-detail preview. If geometry looks correct, proceed to Step C.
- **Step C (UI/State Issues)**: If UI shows inconsistency or data corruption, inspect React state flows, hooks, and component lifecycle. Check metadata synchronization and Three.js scene updates.
- **Step D (Validation)**: Reproduce issues with alternate file formats (STL ASCII/binary, OBJ with/without MTL, PLY ASCII/binary) and test with corrupted/partial files.

### When Optimizing
- Use React.memo for heavy components
- Implement lazy loading for large geometries
- Optimize Three.js renderer settings
- Profile using React DevTools

## Code Style Guidelines

- Use modern JavaScript (ES6+)
- Prefer functional components and hooks
- Use descriptive variable names
- Add comments for complex algorithms
- Keep components under 300 lines

## Testing

- Test with various 3D file formats
- Verify metadata extraction accuracy
- Check UI responsiveness on different screen sizes
- Test file upload with large files

## Build and Deployment

- `npm run dev` - Start development server
- `npm run build` - Create production build
- Build output goes to `dist/` folder

---

**Last Updated**: May 2026
