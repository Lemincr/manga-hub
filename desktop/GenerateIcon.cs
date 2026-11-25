using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

class IconGen
{
    static GraphicsPath RoundedRect(RectangleF r, float radius)
    {
        float d = radius * 2f;
        var p = new GraphicsPath();
        p.AddArc(r.X, r.Y, d, d, 180, 90);
        p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        p.CloseFigure();
        return p;
    }

    static Bitmap RenderIcon(int size)
    {
        var bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.Clear(Color.Transparent);

            float s = size / 256f;
            var outer = new RectangleF(14 * s, 14 * s, 228 * s, 228 * s);
            using (var path = RoundedRect(outer, 54 * s))
            using (var bg = new LinearGradientBrush(outer, Color.FromArgb(30, 27, 75), Color.FromArgb(124, 58, 237), LinearGradientMode.ForwardDiagonal))
            {
                g.FillPath(bg, path);
                using (var borderPen = new Pen(Color.FromArgb(110, 167, 139, 250), Math.Max(1f, 6 * s)))
                {
                    g.DrawPath(borderPen, path);
                }
            }

            // Left & right manga book pages
            using (var leftPage = RoundedRect(new RectangleF(56 * s, 60 * s, 68 * s, 122 * s), 12 * s))
            using (var rightPage = RoundedRect(new RectangleF(132 * s, 60 * s, 68 * s, 122 * s), 12 * s))
            using (var pageBrushL = new SolidBrush(Color.FromArgb(245, 243, 255)))
            using (var pageBrushR = new SolidBrush(Color.FromArgb(232, 226, 254)))
            {
                g.FillPath(pageBrushL, leftPage);
                g.FillPath(pageBrushR, rightPage);
            }

            // Panel blocks
            using (var p1 = RoundedRect(new RectangleF(68 * s, 76 * s, 44 * s, 34 * s), 6 * s))
            using (var p2 = RoundedRect(new RectangleF(68 * s, 118 * s, 44 * s, 48 * s), 6 * s))
            using (var p3 = RoundedRect(new RectangleF(144 * s, 122 * s, 44 * s, 44 * s), 6 * s))
            using (var b1 = new SolidBrush(Color.FromArgb(215, 76, 29, 149)))
            using (var b2 = new SolidBrush(Color.FromArgb(190, 109, 40, 217)))
            {
                g.FillPath(b1, p1);
                g.FillPath(b2, p2);
                g.FillPath(b2, p3);
            }

            // Pink/violet bookmark ribbon on top-right page
            PointF[] ribbon = new PointF[]
            {
                new PointF(150 * s, 46 * s),
                new PointF(184 * s, 46 * s),
                new PointF(184 * s, 116 * s),
                new PointF(167 * s, 103 * s),
                new PointF(150 * s, 116 * s),
            };
            using (var rb = new LinearGradientBrush(new RectangleF(150 * s, 46 * s, 34 * s, 72 * s), Color.FromArgb(192, 132, 252), Color.FromArgb(236, 72, 153), LinearGradientMode.Vertical))
            {
                g.FillPolygon(rb, ribbon);
            }
        }
        return bmp;
    }

    static byte[] PngBytes(Bitmap bmp)
    {
        using (var ms = new MemoryStream())
        {
            bmp.Save(ms, ImageFormat.Png);
            return ms.ToArray();
        }
    }

    static void Main(string[] args)
    {
        string outPng = args[0];
        string outIco = args[1];
        Directory.CreateDirectory(Path.GetDirectoryName(outPng));
        Directory.CreateDirectory(Path.GetDirectoryName(outIco));
        using (var b256 = RenderIcon(256))
        {
            b256.Save(outPng, ImageFormat.Png);
        }
        int[] sizes = new int[] { 16, 32, 48, 64, 128, 256 };
        var blobs = new List<byte[]>();
        foreach (int sz in sizes)
        {
            using (var b = RenderIcon(sz)) blobs.Add(PngBytes(b));
        }
        using (var fs = new FileStream(outIco, FileMode.Create, FileAccess.Write))
        using (var bw = new BinaryWriter(fs))
        {
            bw.Write((ushort)0);
            bw.Write((ushort)1);
            bw.Write((ushort)sizes.Length);
            int offset = 6 + (16 * sizes.Length);
            for (int i = 0; i < sizes.Length; i++)
            {
                int sz = sizes[i];
                bw.Write((byte)(sz >= 256 ? 0 : sz));
                bw.Write((byte)(sz >= 256 ? 0 : sz));
                bw.Write((byte)0);
                bw.Write((byte)0);
                bw.Write((ushort)1);
                bw.Write((ushort)32);
                bw.Write(blobs[i].Length);
                bw.Write(offset);
                offset += blobs[i].Length;
            }
            foreach (var blob in blobs) bw.Write(blob);
        }
    }
}
