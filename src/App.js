// src/App.js
import React, { useState, useCallback, useRef, useEffect } from "react"; // Added useEffect
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragOverlay,
  closestCenter,
} from "@dnd-kit/core";
import { v4 as uuidv4 } from "uuid";
// REMOVE jsPDF and html2canvas imports
// import jsPDF from "jspdf";
// import html2canvas from "html2canvas";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";
import { storage } from "./firebase";

// --- Import @react-pdf/renderer ---
import { BlobProvider } from "@react-pdf/renderer";
import RecipePdfDocument from "./RecipePdfDocument"; // Import the new PDF component

// ... (other imports remain the same)
import RecipeInfoForm from "./RecipeInfoForm";
import ActionPalette from "./ActionPalette";
import RecipeGrid from "./RecipeGrid";
import SummaryModal from "./SummaryModal";
import ActionItem from "./ActionItem";
// PlacedAction is still needed for the web UI grid
// import PlacedAction from "./PlacedAction";
import { findActionById } from "./actions";
import LandingPage from "./LandingPage";
import NotesModal from "./NotesModal";
import PdfGenerationHandler from "./PdfGenerationHandler"; // Adjust path if needed

import HowToUseIcon from "./designs/howtouse.png";
import InfoIcon from "./designs/info.png";
import MascotIcon from "./designs/mascot.png";
import NotesIcon from "./designs/notes.png";
import PotIcon from "./designs/pot.png";

import CookingPNG from "./designs/cooking.png";
import ServePNG from "./designs/serve.png"; // Import the new image
import instructionsImage from "./designs/instructions.png";
import PrintPNG from "./designs/print.png"; // Import the new image

import "./App.css";

// Define Grid Size
const GRID_SIZE = 5;

// Helper to create the empty state for a square
const createEmptySquare = () => ({ action: null, label: "", miniBoxes: [] });

// Initialize Grid State
const initialGridItems = {};
for (let r = 0; r < GRID_SIZE; r++) {
  for (let c = 0; c < GRID_SIZE; c++) {
    const id = `square-${r}-${c}`;
    initialGridItems[id] = createEmptySquare();
  }
}

function App() {
  const [notes, setNotes] = useState(""); // <-- Add state for notes text
  const [isNotesModalOpen, setIsNotesModalOpen] = useState(false); // <-- State for modal visibility
  const [showInstructions, setShowInstructions] = useState(false);
  // --- State for Landing Page ---
  const [showApp, setShowApp] = useState(false); // <-- Start showing landing page

  const [recipeInfo, setRecipeInfo] = useState({
    name: "",
    author: "",
    cookTime: "",
    date: "",
  });
  const [gridItems, setGridItems] = useState(initialGridItems);
  const [activeDragData, setActiveDragData] = useState(null);
  const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false);
  const [qrData, setQrData] = useState("");
  const [isLoadingPdf, setIsLoadingPdf] = useState(false);
  const [pdfError, setPdfError] = useState(null);

  // --- NEW State: PDF Blob ---
  // Store the generated blob temporarily before upload trigger
  const [pdfBlob, setPdfBlob] = useState(null);
  // Flag to indicate if PDF generation is complete (needed by BlobProvider)
  const [pdfGenerated, setPdfGenerated] = useState(false);
  // Flag to trigger PDF generation
  const [triggerPdfGeneration, setTriggerPdfGeneration] = useState(false);

  // --- ADD STATE FOR PLACEHOLDER VISIBILITY ---
  const [isInfoPlaceholderVisible, setIsInfoPlaceholderVisible] =
    useState(false);
  // --- END ADD ---

  // --- Add confirmation before leaving/closing the page ---
  useEffect(() => {
    const handleBeforeUnload = (event) => {
      // Standard way to trigger the browser's confirmation dialog
      event.preventDefault();
      // Required for some older browsers
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    // Cleanup function to remove the listener when the component unmounts
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, []); // Empty dependency array ensures this runs only on mount and unmount
  // --- End confirmation logic ---

  // --- ADD HANDLER TO SHOW PLACEHOLDER ---
  const handleInfoButtonClick = () => {
    setIsInfoPlaceholderVisible(true);
  };
  // --- END ADD ---

  // --- NEW: Function to toggle instructions popup ---
  const toggleInstructions = () => {
    setShowInstructions(!showInstructions);
  };

  // --- ADD HANDLER TO HIDE PLACEHOLDER ---
  const handleCloseInfoPlaceholder = () => {
    setIsInfoPlaceholderVisible(false);
  };
  // --- END ADD ---
  // Ref for the VISIBLE grid (still needed for print maybe, or just structure)
  const gridRef = useRef(null);

  const sensors = useSensors(
    useSensor(PointerSensor)
    // useSensor(KeyboardSensor)
  );

  // --- Handlers for Notes Modal ---
  const handleOpenNotesModal = () => {
    setIsNotesModalOpen(true);
  };

  const handleCloseNotesModal = () => {
    setIsNotesModalOpen(false);
  };

  const handleNotesChange = (newNotes) => {
    setNotes(newNotes);
  };

  // --- Handler to switch from Landing Page to App ---
  const handleStart = () => {
    setShowApp(true); // <-- Set state to show the main app
  };

  // --- Callbacks (handleRecipeInfoChange, handleLabelChange, handleDeleteAction, handleAddMiniBox, handleMiniBoxDelete) remain the same ---
  const handleRecipeInfoChange = (newInfo) => {
    setRecipeInfo(newInfo);
  };

  const handleLabelChange = useCallback(
    (squareId, newLabel) => {
      setGridItems((prevGrid) => {
        const currentItem = prevGrid[squareId];

        if (!currentItem || !currentItem.action) {
          console.warn(
            `[handleLabelChange] Item not found or has no action for squareId: ${squareId}`
          );
          return prevGrid;
        }

        // Capture labels before potential update
        const originalLabel =
          currentItem.originalLabel !== undefined
            ? currentItem.originalLabel
            : currentItem.action?.name || currentItem.label || "";
        const oldLabel =
          currentItem.currentLabel !== undefined
            ? currentItem.currentLabel
            : currentItem.label || currentItem.action?.name || ""; // Use action name as fallback for old label too

        // Only proceed if the label actually changed
        if (oldLabel === newLabel) {
          return prevGrid; // No change needed
        }

        // --- Update Notes ---
        setNotes((prevNotes) => {
          // Pattern for the note we want to REMOVE
          const oldPattern = `${originalLabel} --> (${oldLabel})`;
          // The new note line we want to ADD
          const newNoteLine = `${originalLabel} --> (${newLabel})`; // No \n yet

          const lines = (prevNotes || "").split("\n");
          let linesRemovedCount = 0;

          // Filter out the *old* note, comparing trimmed lines
          const filteredLines = lines.filter((line) => {
            const trimmedLine = line.trim();
            // Check if the trimmed line exactly matches the old pattern
            const shouldRemove = trimmedLine === oldPattern;
            if (shouldRemove && trimmedLine !== "") {
              // Only count if we are removing a non-empty line
              linesRemovedCount++;
            }
            // Keep lines that don't match the old pattern OR were empty lines originally
            return !shouldRemove || trimmedLine === "";
          });

          // Add the *new* note line (only if originalLabel exists, which it should if renamed)
          if (originalLabel) {
            // Avoid adding duplicates if somehow the new note is already there
            if (!filteredLines.some((line) => line.trim() === newNoteLine)) {
              filteredLines.push(newNoteLine);
            }
          }

          // Clean up: remove any blank lines that might result from filtering/splitting
          const finalLines = filteredLines.filter((line) => line.trim() !== "");

          const finalNotes = finalLines.join("\n"); // Join remaining lines

          return finalNotes; // Return the potentially modified notes string
        });
        // --- End Notes Update ---

        // --- Return updated Grid ---
        return {
          ...prevGrid,
          [squareId]: {
            ...currentItem,
            originalLabel: originalLabel, // Ensure originalLabel is preserved
            currentLabel: newLabel, // Update the currentLabel
            label: undefined, // Remove the old 'label' property explicitly
          },
        };
      }); // --- End setGridItems callback ---
    },
    [setGridItems, setNotes] // Keep dependencies
  );
  // --- END REWRITE handleLabelChange ---
  const handleDeleteAction = useCallback(
    (squareIdToDelete) => {
      // --- Update gridItems AND trigger notes update from within ---
      setGridItems((currentGridItems) => {
        const itemToDelete = currentGridItems[squareIdToDelete];

        // Guard clause: If square is already empty or invalid, do nothing
        if (!itemToDelete || !itemToDelete.action) {
          console.warn(
            `[handleDeleteAction] Square ${squareIdToDelete} not found or empty for deletion.`
          );
          return currentGridItems; // Return current state, no change
        }

        // Capture the labels *before* deleting the item
        const originalLabel =
          itemToDelete.originalLabel !== undefined
            ? itemToDelete.originalLabel
            : itemToDelete.action?.name || itemToDelete.label || "";
        const currentLabel =
          itemToDelete.currentLabel !== undefined
            ? itemToDelete.currentLabel
            : itemToDelete.label || itemToDelete.action?.name || "";

        // Determine if a note *might* need removal (only if it was ever renamed)
        const noteShouldBeRemoved =
          originalLabel && originalLabel !== currentLabel;

        // --- MOVED NOTES UPDATE LOGIC HERE ---
        if (noteShouldBeRemoved) {
          const noteToRemovePatternEnd = `${originalLabel} --> (${currentLabel})`; // NO trailing \n here

          // Use functional update for setNotes INSIDE setGridItems callback
          setNotes((prevNotes) => {
            if (!prevNotes) {
              console.log(
                "[handleDeleteAction - setNotes] No previous notes to modify."
              );
              return "";
            }

            const lines = prevNotes.split("\n");
            let linesRemovedCount = 0;

            const updatedLines = lines.filter((line) => {
              const trimmedLine = line.trim();
              const shouldKeep = trimmedLine !== noteToRemovePatternEnd;
              if (!shouldKeep && trimmedLine !== "") {
                linesRemovedCount++;
              }
              return (
                shouldKeep || (trimmedLine === "" && prevNotes.trim() !== "")
              );
            });

            if (linesRemovedCount > 0) {
              const result = updatedLines.join("\n");
              const finalNotes = result.trim(); // Trim final result
              console.log(
                "[handleDeleteAction - setNotes] New Notes:",
                JSON.stringify(finalNotes)
              );
              return finalNotes;
            } else {
              console.log(
                "[handleDeleteAction - setNotes] Note pattern not found."
              );
              return prevNotes; // Return original notes if no match
            }
          });
        } else {
          console.log(
            "[handleDeleteAction] No rename detected for deleted item, notes not modified."
          );
        }
        // --- END MOVED NOTES UPDATE LOGIC ---

        // Return the updated grid state with the square cleared
        return {
          ...currentGridItems,
          [squareIdToDelete]: createEmptySquare(), // Clear the square
        };
      }); // --- End setGridItems callback ---

      // --- REMOVE the notes update logic from here ---
      // if (noteShouldBeRemoved) { ... } // <-- DELETE THIS BLOCK
    },
    [setGridItems, setNotes] // Keep dependencies
  );

  const handleAddMiniBox = useCallback((squareId) => {
    setGridItems((prev) => {
      const currentSquare = prev[squareId];
      if (!currentSquare || currentSquare.miniBoxes.length >= 3) return prev;

      const positions = ["right", "top", "bottom"];
      const existingPositions = currentSquare.miniBoxes.map(
        (box) => box.position
      );
      let nextPosition = positions.find(
        (pos) => !existingPositions.includes(pos)
      );

      if (!nextPosition) return prev;

      const newMiniBox = { id: uuidv4(), action: null, position: nextPosition };

      return {
        ...prev,
        [squareId]: {
          ...currentSquare,
          miniBoxes: [...currentSquare.miniBoxes, newMiniBox],
        },
      };
    });
  }, []);

  const handleMiniBoxDelete = useCallback((squareId, miniBoxId) => {
    setGridItems((prev) => {
      const currentSquare = prev[squareId];
      if (!currentSquare) return prev;
      return {
        ...prev,
        [squareId]: {
          ...currentSquare,
          miniBoxes: currentSquare.miniBoxes.filter(
            (box) => box.id !== miniBoxId
          ),
        },
      };
    });
  }, []);

  // --- Dnd Handlers (handleDragStart, handleDragEnd, handleDragCancel) remain the same ---
  const handleDragStart = (event) => {
    setActiveDragData(event.active.data.current ?? null);
  };

  const handleDragEnd = (event) => {
    const { active, over } = event;
    setActiveDragData(null);
    if (!over || active.id === over.id) return;

    const activeData = active.data.current;
    const sourceId = active.id;
    const targetId = over.id;

    // Palette -> Grid Square
    if (
      targetId.startsWith("square-") &&
      sourceId.startsWith("action-") &&
      activeData?.action
    ) {
      const action = activeData.action;
      setGridItems((prev) => ({
        ...prev,
        [targetId]: {
          action: action,
          // --- ADD originalLabel and use currentLabel ---
          originalLabel: action.name || "", // Store the original name
          currentLabel: action.name || "", // Initialize the editable label
          // --- END ADD ---
          miniBoxes: [], // Initialize miniBoxes
        },
      }));
      return;
    }

    // Grid Square -> Grid Square
    if (
      targetId.startsWith("square-") &&
      sourceId.startsWith("square-") &&
      activeData?.type === "grid-item" &&
      activeData?.item
    ) {
      const draggedItemData = activeData.item;

      // --- Prepare the item being moved, ensuring labels are correct ---
      // Use currentLabel if it exists, otherwise fall back to old 'label'
      const currentLabelValue =
        draggedItemData.currentLabel !== undefined
          ? draggedItemData.currentLabel
          : draggedItemData.label;
      // Use originalLabel if it exists, otherwise fall back to action name or old 'label'
      const originalLabelValue =
        draggedItemData.originalLabel !== undefined
          ? draggedItemData.originalLabel
          : draggedItemData.action?.name || currentLabelValue || "";

      const itemToMove = {
        ...draggedItemData, // Copy other properties like action, miniBoxes
        originalLabel: originalLabelValue,
        currentLabel: currentLabelValue,
      };
      // Remove the old 'label' property if it exists to avoid confusion
      delete itemToMove.label;
      // --- End preparation ---

      setGridItems((prev) => {
        const newGrid = { ...prev };
        // Place the prepared item in the target square
        newGrid[targetId] = itemToMove;
        // Clear the source square
        newGrid[sourceId] = createEmptySquare();
        return newGrid;
      });
      return;
    }

    // Palette -> MiniBox
    if (
      targetId.startsWith("minibox-") &&
      sourceId.startsWith("action-") &&
      activeData?.action
    ) {
      const droppedAction = activeData.action;
      const prefix = "minibox-";
      const remainingId = targetId.substring(prefix.length);
      const squareIdParts = remainingId.split("-").slice(0, 3);
      const parentSquareId = squareIdParts.join("-");
      const uuidStartIndex = parentSquareId.length + 1;
      const miniBoxUuid = remainingId.substring(uuidStartIndex);

      setGridItems((prev) => {
        if (!prev[parentSquareId]) {
          console.error("Parent square not found:", parentSquareId);
          return prev;
        }
        let foundMiniBox = false;
        const updatedMiniBoxes = prev[parentSquareId].miniBoxes.map((mb) => {
          if (mb.id === miniBoxUuid) {
            foundMiniBox = true;
            // --- Optional: Add labels to mini-box actions if they can be renamed ---
            // return {
            //   ...mb,
            //   action: {
            //       ...droppedAction,
            //       originalLabel: droppedAction.name || "",
            //       currentLabel: droppedAction.name || ""
            //   }
            // };
            // --- If mini-boxes are NOT renamed, keep it simple: ---
            return { ...mb, action: droppedAction };
          }
          return mb;
        });

        if (!foundMiniBox) {
          console.error(
            "Target MiniBox UUID not found:",
            miniBoxUuid,
            parentSquareId
          );
          return prev;
        }
        return {
          ...prev,
          [parentSquareId]: {
            ...prev[parentSquareId],
            miniBoxes: updatedMiniBoxes,
          },
        };
      });
      return;
    }
  };

  const handleDragCancel = () => {
    setActiveDragData(null);
  };

  // --- PDF Generation and Upload Logic ---

  // Function to trigger PDF generation via BlobProvider
  const handleGeneratePdf = () => {
    setIsLoadingPdf(true); // Show loading state early
    setPdfError(null);
    setQrData("");
    setPdfBlob(null); // Clear previous blob
    setPdfGenerated(false); // Reset generated flag
    setIsSummaryModalOpen(true); // Open modal
    setTriggerPdfGeneration(true); // Signal BlobProvider to render
  };

  // Function to upload the generated blob
  const uploadPdfBlob = async (blobToUpload) => {
    if (!blobToUpload) {
      console.error("Upload attempt with no blob.");
      setPdfError("PDF Blob was not generated correctly.");
      setIsLoadingPdf(false);
      return;
    }
    // Keep isLoadingPdf true during upload

    try {
      const pdfFileName = `recipe-${uuidv4()}.pdf`;
      const fileRef = storageRef(storage, `recipes/${pdfFileName}`);

      const uploadResult = await uploadBytes(fileRef, blobToUpload);

      const downloadURL = await getDownloadURL(uploadResult.ref);

      setQrData(downloadURL); // Set QR data for the modal
      setPdfError(null); // Clear any previous error
    } catch (error) {
      console.error("Error uploading PDF:", error);
      setPdfError(`Failed to upload PDF: ${error.message || error}`);
      setQrData(""); // Clear QR data on error
    } finally {
      setIsLoadingPdf(false); // Turn off loading state
      setTriggerPdfGeneration(false); // Generation/upload cycle complete
      setPdfBlob(null); // Clear the blob from state
      setPdfGenerated(false); // Reset generated flag
    }
  };

  // Effect to upload the blob once it's generated and stored in state
  useEffect(() => {
    if (pdfBlob && pdfGenerated) {
      uploadPdfBlob(pdfBlob);
    }
  }, [pdfBlob, pdfGenerated]); // Depend on blob and the generated flag

  // --- End PDF Logic ---

  // Print function remains the same
  const handlePrint = () => {
    window.print();
  };

  // Drag Overlay rendering remains the same
  const renderDragOverlay = () => {
    if (!activeDragData) return null;
    const action = activeDragData.action || activeDragData.item?.action;
    if (action) {
      return <ActionItem action={action} />; // Use ActionItem for consistent look
    }
    return null;
  };

  // --- Conditional Rendering ---
  if (!showApp) {
    // If showApp is false, render the Landing Page
    return <LandingPage onStart={handleStart} />;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {/* App Container now holds the main content area and the info panel */}
      <div className="app-container">
        {/* NEW: Wrapper for Left and Middle Panels */}
        <div className="main-content-area">
          {/* Panel 1: Left Panel (Existing) */}
          <div className="left-panel">
            <RecipeInfoForm
              info={recipeInfo}
              onChange={handleRecipeInfoChange}
            />
            <ActionPalette />
          </div>

          {/* Panel 2: Middle Panel (Previously Right Panel) */}
          <div className="right-panel">
            {" "}
            {/* Keep class name */}
            <div className="recipe-grid-outer-container">
              <div className="recipe-grid-title">
                <img
                  src={CookingPNG} /* Use the URL from the default import */
                  alt="" /* Alt text is handled by aria-label on button */
                  className="cooking-icon"
                />
              </div>
              <RecipeGrid
                ref={gridRef}
                items={gridItems}
                onLabelChange={handleLabelChange}
                onAddMiniBox={handleAddMiniBox}
                onMiniBoxDelete={handleMiniBoxDelete}
                onDeleteAction={handleDeleteAction}
              />
            </div>
            <div className="action-buttons">
              <button className="notes-button" onClick={handleOpenNotesModal}>
                <img
                  src={NotesIcon} /* Use the URL from the default import */
                  alt="" /* Alt text is handled by aria-label on button */
                  className="notes-icon"
                />
              </button>
              <button
                className="serve-button"
                onClick={handleGeneratePdf}
                disabled={isLoadingPdf}
              >
                <img
                  src={ServePNG} /* Use the URL from the default import */
                  alt="" /* Alt text is handled by aria-label on button */
                  className="serve-icon"
                />
              </button>
              <button className="print-button" onClick={handlePrint}>
                <img
                  src={PrintPNG} /* Use the URL from the default import */
                  alt="" /* Alt text is handled by aria-label on button */
                  className="print-icon"
                />
              </button>
            </div>
          </div>
        </div>{" "}
        {/* End main-content-area */}
        {/* Panel 3: Info Side Panel (Now a direct sibling of main-content-area) */}
        <div className="info-side-panel">
          {/* --- ADD THE NEW BUTTON HERE --- */}
          <button
            className="info-panel-middle-left-button"
            // --- CHANGE THIS LINE ---
            onClick={toggleInstructions} // Use the handler function directly
            // --- END CHANGE ---
            aria-label="Show Information" // Accessibility label
          >
            {/* Icon remains the same */}
            <img
              src={InfoIcon} /* Use the URL from the default import */
              alt="" /* Alt text is handled by aria-label on button */
              className="button-info-icon infoicon"
            />
          </button>
          {/* --- END NEW BUTTON --- */}
          <img
            src={PotIcon}
            alt="Pot"
            className="info-panel-image poticon"
          />{" "}
          {/* Pot first */}
          <img
            src={HowToUseIcon}
            alt="How to Use"
            className="info-panel-image howtouseicon"
          />
          <img
            src={MascotIcon}
            alt="Mascot"
            className="info-panel-image mascoticon"
          />
          {/* Add specific components here later as needed */}
        </div>
      </div>

      {/* Notes Section for Printing */}
      {notes && notes.trim() !== "" && (
        <div className="print-notes-section">
          <h2>Notes</h2>
          <pre className="print-notes-content">{notes}</pre>
        </div>
      )}

      {isInfoPlaceholderVisible && (
        <div className="info-placeholder-container">
          {/* Add a close button inside the placeholder */}
          <button
            className="info-placeholder-close-button"
            onClick={handleCloseInfoPlaceholder}
            aria-label="Close Info"
          >
            &times; {/* HTML entity for 'X' */}
          </button>
          {/* Placeholder Content Area - Image will go here later */}
          <div className="info-placeholder-content">
            {/* Intentionally empty for now */}
            {/* TEMPORARY TEXT FOR DEBUGGING */}
            <p style={{ color: "black", fontSize: "20px" }}>Instructions</p>
          </div>
        </div>
      )}
      {/* DragOverlay rendering remains the same */}
      <DragOverlay className="drag-overlay">{renderDragOverlay()}</DragOverlay>

      {/* --- BlobProvider for PDF Generation --- */}
      {/* --- BlobProvider for PDF Generation --- */}
      {triggerPdfGeneration && (
        <BlobProvider
          document={
            <RecipePdfDocument
              recipeInfo={recipeInfo}
              gridItems={gridItems}
              notes={notes}
            />
          }
        >
          {(
            { blob, url, loading, error } // <-- Keep the render prop function
          ) => (
            // Render the new handler component and pass props
            <PdfGenerationHandler
              blob={blob}
              loading={loading}
              error={error}
              triggerPdfGeneration={triggerPdfGeneration}
              pdfGenerated={pdfGenerated}
              pdfBlob={pdfBlob}
              pdfError={pdfError}
              setPdfBlob={setPdfBlob}
              setPdfGenerated={setPdfGenerated}
              setPdfError={setPdfError}
              setIsLoadingPdf={setIsLoadingPdf}
              setTriggerPdfGeneration={setTriggerPdfGeneration}
            />
          )}
        </BlobProvider>
      )}

      {/* Summary Modal remains the same, props are updated by the new flow */}
      <SummaryModal
        isOpen={isSummaryModalOpen}
        onClose={() => {
          setIsSummaryModalOpen(false);
          // Optionally reset states if modal is closed prematurely
          // setIsLoadingPdf(false);
          // setPdfError(null);
          // setTriggerPdfGeneration(false);
        }}
        qrData={qrData}
        isLoading={isLoadingPdf}
        error={pdfError}
      />

      {/* --- ADDED NOTES MODAL RENDER --- */}
      <NotesModal
        isOpen={isNotesModalOpen}
        onClose={handleCloseNotesModal}
        notes={notes}
        onNotesChange={handleNotesChange}
      />
      {/* --- END NOTES MODAL RENDER --- */}

      {/* --- NEW: Instructions Popup --- */}
      {showInstructions && (
        <div className="instructions-popup-container">
          <button
            className="instructions-popup-close-button"
            onClick={toggleInstructions}
          >
            &times; {/* Simple 'X' character */}
          </button>
          <div className="instructions-popup-content">
            <img
              src={instructionsImage}
              alt="Instructions"
              className="instructions-image"
            />
          </div>
        </div>
      )}
    </DndContext>
  );
}

export default App;
